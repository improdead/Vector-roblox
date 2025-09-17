-- Vector Plugin — minimal chat and proposal UI
-- UI patch: make composer auto-size and reflow sections
-- - Collects context (active script + selection)
-- - Sends to /api/chat
-- - Renders proposals with Approve/Reject
-- - Applies simple edit insertions and rename_instance ops

print("[Vector] starting")

local Http = require(script.Parent.net.http)
local HttpService = game:GetService("HttpService")
local StudioService = game:GetService("StudioService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local InsertService = game:GetService("InsertService")
local UserInputService = game:GetService("UserInputService")
local ServerStorage = game:GetService("ServerStorage")
local ToolCreate = require(script.Parent.tools.create_instance)
local ToolSetProps = require(script.Parent.tools.set_properties)
local ToolRename = require(script.Parent.tools.rename_instance)
local ToolDelete = require(script.Parent.tools.delete_instance)
local ToolApplyEdit = require(script.Parent.tools.apply_edit)

print("[Vector] imported modules")

-- UI state (shared across UI and actions)
local CURRENT_MODE = "agent" -- or "ask"

local function getActiveScriptContext()
	local s = StudioService.ActiveScript
	if not s then
		return nil
	end
	local ok, src = pcall(function()
		return ScriptEditorService:GetEditorSource(s)
	end)
	return {
		path = s:GetFullName(),
		text = ok and src or "",
	}
end

local function getSelectionContext()
	local out = {}
	for _, inst in ipairs(Selection:Get()) do
		table.insert(out, {
			className = inst.ClassName,
			path = inst:GetFullName(),
		})
	end
	return out
end

local function requestScriptPermission()
    if _G.__VECTOR_PERMISSION_OK then
        return true
    end

    local probe = Instance.new("Script")
    probe.Name = "__VectorPermissionProbe"
    probe.Source = "-- Vector permission probe"
    probe.Parent = ServerStorage

    if not ChangeHistoryService:TryBeginRecording("Vector Permission Probe", "Vector Permission Probe") then
        probe:Destroy()
        return false, "ChangeHistoryService denied recording"
    end

    local ok, err = pcall(function()
        if ScriptEditorService.UpdateSourceAsync then
            ScriptEditorService:UpdateSourceAsync(probe, function(old)
                return "-- Vector permission probe\n" .. (old or "")
            end)
        else
            local newText = "-- Vector permission probe\n" .. (probe.Source or "")
            ScriptEditorService:SetEditorSource(probe, newText)
        end
    end)

    ChangeHistoryService:FinishRecording("Vector Permission Probe")
    probe:Destroy()

    if ok then
        _G.__VECTOR_PERMISSION_OK = true
        return true
    else
        return false, tostring(err)
    end
end

local function ensurePermissionWithStatus()
    if _G.__VECTOR_PERMISSION_OK then
        return true
    end
    local ok, err = requestScriptPermission()
    local ui = _G.__VECTOR_UI
    if ok then
        if ui and ui.addStatus then ui.addStatus("permission.ok script modification granted") end
        return true
    else
        if ui and ui.addStatus then ui.addStatus("permission.err " .. tostring(err or "failed")) end
        return false
    end
end

local function resolveByFullName(path)
    if typeof(path) == "Instance" then return path end
    if type(path) ~= "string" or #path == 0 then return nil end
    local function unquote(s)
        if type(s) ~= "string" or #s < 2 then return s end
        local a = string.sub(s,1,1)
        local b = string.sub(s,-1,-1)
        if (a == '"' or a == "'") and b == a then
            return string.sub(s,2,-2)
        end
        return s
    end
    local tokens = {}
    do
        local buf, inBr = {}, false
        for i = 1, #path do
            local ch = string.sub(path, i, i)
            if ch == "[" then inBr = true
            elseif ch == "]" then inBr = false
            elseif ch == "." and not inBr then
                table.insert(tokens, unquote(table.concat(buf))); buf = {}
            else
                table.insert(buf, ch)
            end
        end
        if #buf > 0 then table.insert(tokens, unquote(table.concat(buf))) end
    end
    local i = 1
    if tokens[1] == "game" then i = 2 end
    local cur
    if tokens[i] then
        local head = tokens[i]
        local ok, svc = pcall(function() return game:GetService(head) end)
        if ok and svc then cur = svc else cur = game:FindFirstChild(head) end
        i += 1
    else
        cur = game
    end
    while cur and tokens[i] do
        local child = cur:FindFirstChild(tokens[i])
        if not child then return nil end
        cur = child
        i += 1
    end
    return cur
end

local function posToIndex(text, pos)
	local line = pos.line or 0
	local char = pos.character or 0
	local idx = 1
	local currentLine = 0
	local i = 1
	while currentLine < line do
		local nl = string.find(text, "\n", i, true)
		if not nl then
			-- beyond end: place at end
			return #text + 1 + char
		end
		i = nl + 1
		currentLine += 1
	end
	return i + char
end

local function applyRangeEdits(oldText, edits)
	-- Sort descending by start index to avoid offset shifts
	local enriched = {}
	for _, e in ipairs(edits) do
		local sidx = posToIndex(oldText, e.start)
		local eidx = posToIndex(oldText, e["end"]) -- exclusive
		table.insert(enriched, { sidx = sidx, eidx = eidx, text = e.text })
	end
	table.sort(enriched, function(a, b)
		return a.sidx > b.sidx
	end)
	local newText = oldText
	for _, e in ipairs(enriched) do
		newText = string.sub(newText, 1, e.sidx - 1) .. e.text .. string.sub(newText, e.eidx)
	end
	return newText
end

-- SHA-1 for edit safety
local function sha1(msg)
    local function num2s(l, n)
        local s = ""
        for i = 1, n do
            local rem = l % 256
            s = string.char(rem) .. s
            l = (l - rem) / 256
        end
        return s
    end
    local function s232num(s, i)
        local n = 0
        for j = i, i + 3 do n = n*256 + string.byte(s, j) end
        return n
    end
    local function preproc(msg, len)
        local extra = 64 - ((len + 9) % 64)
        msg = msg .. string.char(0x80) .. string.rep(string.char(0), extra) .. num2s(8*len, 8)
        return msg
    end
    local function rol(n, b)
        local left = bit32.lshift(n, b)
        local right = bit32.rshift(n, 32 - b)
        return bit32.band(bit32.bor(left, right), 0xffffffff)
    end
    local h0, h1, h2, h3, h4 = 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0
    msg = preproc(msg, #msg)
    for i = 1, #msg, 64 do
        local w = {}
        for j = 0, 15 do
            w[j+1] = s232num(msg, i + j*4)
        end
        for j = 17, 80 do
            w[j] = rol(bit32.bxor(bit32.bxor(w[j-3], w[j-8]), bit32.bxor(w[j-14], w[j-16])), 1)
        end
        local a, b, c, d, e = h0, h1, h2, h3, h4
        for j = 1, 80 do
            local f, k
            if j <= 20 then
                f = bit32.bor(bit32.band(b, c), bit32.band(bit32.bnot(b), d))
                k = 0x5A827999
            elseif j <= 40 then
                f = bit32.bxor(bit32.bxor(b, c), d)
                k = 0x6ED9EBA1
            elseif j <= 60 then
                f = bit32.bor(bit32.bor(bit32.band(b, c), bit32.band(b, d)), bit32.band(c, d))
                k = 0x8F1BBCDC
            else
                f = bit32.bxor(bit32.bxor(b, c), d)
                k = 0xCA62C1D6
            end
            local temp = (rol(a, 5) + f + e + k + w[j]) % 0x100000000
            e = d; d = c; c = rol(b, 30); b = a; a = temp
        end
        h0 = (h0 + a) % 0x100000000
        h1 = (h1 + b) % 0x100000000
        h2 = (h2 + c) % 0x100000000
        h3 = (h3 + d) % 0x100000000
        h4 = (h4 + e) % 0x100000000
    end
    return string.format("%08x%08x%08x%08x%08x", h0, h1, h2, h3, h4)
end

-- Expose sha1 globally for tool modules (conflict detection)
_G.__VECTOR_SHA1 = sha1

-- Diff utilities (line-by-line unified diff)
local function splitLines(text)
	local t = {}
	local i = 1
	for line in string.gmatch(text, "([^\n]*)\n?") do
		if i == 1 and line == "" and #text == 0 then break end
		table.insert(t, line)
		i += 1
		if i > 100000 then break end
	end
	return t
end

local function computeLCSOps(a, b)
	local n, m = #a, #b
	local maxCells = 200000 -- guard for very large inputs
	if n * m > maxCells then
		-- Fallback: simple middle hunk based on common prefix/suffix
		local i1, j1 = 1, 1
		while i1 <= n and j1 <= m and a[i1] == b[j1] do
			i1 += 1; j1 += 1
		end
		local i2, j2 = n, m
		while i2 >= i1 and j2 >= j1 and a[i2] == b[j2] do
			i2 -= 1; j2 -= 1
		end
		local ops = {}
		for i = 1, i1 - 1 do table.insert(ops, { tag = 'equal', a = a[i] }) end
		for i = i1, i2 do if a[i] then table.insert(ops, { tag = 'remove', a = a[i] }) end end
		for j = j1, j2 do if b[j] then table.insert(ops, { tag = 'add', b = b[j] }) end end
		for i = i2 + 1, n do table.insert(ops, { tag = 'equal', a = a[i] }) end
		return ops
	end
	-- Build DP table
	local dp = {}
	for i = 0, n do
		dp[i] = {}
		for j = 0, m do
			dp[i][j] = 0
		end
	end
	for i = 1, n do
		for j = 1, m do
			if a[i] == b[j] then
				dp[i][j] = dp[i - 1][j - 1] + 1
			else
				dp[i][j] = math.max(dp[i - 1][j], dp[i][j - 1])
			end
		end
	end
	-- Backtrack
	local i, j = n, m
	local rev = {}
	while i > 0 and j > 0 do
		if a[i] == b[j] then
			table.insert(rev, { tag = 'equal', a = a[i] })
			i -= 1; j -= 1
		elseif dp[i - 1][j] >= dp[i][j - 1] then
			table.insert(rev, { tag = 'remove', a = a[i] })
			i -= 1
		else
			table.insert(rev, { tag = 'add', b = b[j] })
			j -= 1
		end
	end
	while i > 0 do table.insert(rev, { tag = 'remove', a = a[i] }); i -= 1 end
	while j > 0 do table.insert(rev, { tag = 'add', b = b[j] }); j -= 1 end
	-- reverse
	local ops = {}
	for k = #rev, 1, -1 do table.insert(ops, rev[k]) end
	return ops
end

local function buildHunks(ops, context)
	context = context or 2
	local hunks = {}
	local cur = nil
	local aLine, bLine = 1, 1
	local function flush()
		if cur then table.insert(hunks, cur); cur = nil end
	end
	for _, op in ipairs(ops) do
		if op.tag == 'equal' then
			if cur then
				if #cur.lines < cur.lastChangeCtx + context * 2 + 1 then
					-- still within context window
					local text = op.a or op.b or ""
					table.insert(cur.lines, { tag = 'ctx', aLine = aLine, bLine = bLine, text = text })
					cur.lastChangeCtx += 1
				else
					flush()
				end
			else
				-- outside change, do nothing
			end
			aLine += 1; bLine += 1
		elseif op.tag == 'remove' then
			if not cur then
				cur = { aStart = aLine, bStart = bLine, lines = {}, lastChangeCtx = 0 }
			end
			local text = op.a or ""
			table.insert(cur.lines, { tag = 'rem', aLine = aLine, bLine = nil, text = text })
			aLine += 1
			cur.lastChangeCtx = 0
		elseif op.tag == 'add' then
			if not cur then
				cur = { aStart = aLine, bStart = bLine, lines = {}, lastChangeCtx = 0 }
			end
			local text = op.b or ""
			table.insert(cur.lines, { tag = 'add', aLine = nil, bLine = bLine, text = text })
			bLine += 1
			cur.lastChangeCtx = 0
		end
	end
	flush()
	-- compute aLen/bLen for headers
	for _, h in ipairs(hunks) do
		local aLen, bLen = 0, 0
		for _, l in ipairs(h.lines) do
			if l.tag == 'rem' then aLen += 1 end
			if l.tag == 'add' then bLen += 1 end
			if l.tag == 'ctx' then aLen += 1; bLen += 1 end
		end
		h.aLen = aLen; h.bLen = bLen
	end
	return hunks
end

local function renderUnifiedDiff(container, oldText, newText)
	container:ClearAllChildren()
	local a = splitLines(oldText)
	local b = splitLines(newText)
	local ops = computeLCSOps(a, b)
	local hunks = buildHunks(ops, 2)

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 2)
	layout.Parent = container

	local function addLine(text, color)
		local lbl = Instance.new("TextLabel")
		lbl.BackgroundTransparency = 1
		lbl.Font = Enum.Font.Code
		lbl.TextXAlignment = Enum.TextXAlignment.Left
		lbl.TextYAlignment = Enum.TextYAlignment.Top
		lbl.TextWrapped = false
		lbl.Text = text
		lbl.TextColor3 = color
		lbl.Size = UDim2.new(1, -8, 0, 18)
		lbl.Position = UDim2.new(0, 8, 0, 0)
		lbl.Parent = container
	end

	for _, h in ipairs(hunks) do
		local header = string.format("@@ -%d,%d +%d,%d @@", h.aStart, h.aLen, h.bStart, h.bLen)
		addLine(header, Color3.fromRGB(160, 160, 200))
		for _, l in ipairs(h.lines) do
			if l.tag == 'add' then
				addLine("+ " .. l.text, Color3.fromRGB(0, 200, 0))
			elseif l.tag == 'rem' then
				addLine("- " .. l.text, Color3.fromRGB(220, 0, 0))
			else
				addLine("  " .. l.text, Color3.fromRGB(200, 200, 200))
			end
		end
	end

	container.CanvasSize = UDim2.new(0, 0, 0, container.UIListLayout.AbsoluteContentSize.Y + 8)
end

local function applyEditProposal(proposal)
    ensurePermissionWithStatus()
	local inst = resolveByFullName(proposal.path)
	if not inst then
		return false, "Instance not found: " .. tostring(proposal.path)
	end
	local okSrc, old = pcall(function()
		return ScriptEditorService:GetEditorSource(inst)
	end)
	if not okSrc then
		return false, "Cannot read editor source"
	end
	-- Safety: ensure the file hasn't changed since preview
	if proposal.safety and proposal.safety.beforeHash then
		local currentHash = sha1(old)
		if string.lower(tostring(proposal.safety.beforeHash)) ~= string.lower(currentHash) then
			return false, "Edit conflict: file changed since preview. Re-open diff to refresh."
		end
	end
	local newText = applyRangeEdits(old, proposal.diff.edits or {})
	local res = ToolApplyEdit({ script = inst, edits = { __finalText = newText }, beforeHash = proposal.safety and proposal.safety.beforeHash or nil })
	return res and res.ok == true, res and res.error
end

local function openScriptByPath(path)
	local inst = resolveByFullName(path)
	if inst then
		pcall(function()
			ScriptEditorService:OpenScript(inst)
		end)
	end
end

local function getBackendBaseUrl()
    -- Prefer plugin setting if present, fallback to local dev server
    local val
    pcall(function()
        if plugin and plugin.GetSetting then val = plugin:GetSetting("vector_backend_base_url") end
    end)
    if typeof(val) == "string" and #val > 0 then
        return (string.sub(val, -1) == "/") and string.sub(val, 1, -2) or val
    end
    return "http://127.0.0.1:3000"
end

local function reportApply(proposalId, payload)
    local base = getBackendBaseUrl()
    local url = string.format("%s/api/proposals/%s/apply", base, tostring(proposalId))
    task.spawn(function()
        Http.postJson(url, payload)
    end)
end

local function applyRenameOp(op)
    local res = ToolRename(op.path, op.newName)
    return res and res.ok == true, res and res.error
end

local function summarizeProposal(p)
	if p.type == "edit" then
		local count = (p.diff and p.diff.edits and #p.diff.edits) or 0
		return string.format("Edit: %s (%d change%s)", p.path, count, count == 1 and "" or "s")
	elseif p.type == "object_op" then
		return "Object ops (" .. tostring(#p.ops or 0) .. ")"
	elseif p.type == "asset_op" then
		if p.search then
			return "Asset search: " .. (p.search.query or "")
		elseif p.insert then
			return "Insert asset: " .. tostring(p.insert.assetId)
		end
	end
	return "Proposal"
end

local function fetchAssets(query, limit)
    local base = getBackendBaseUrl()
    local url = string.format("%s/api/assets/search?query=%s&limit=%d", base, HttpService:UrlEncode(query or ""), limit or 8)
    local resp = Http.getJson(url)
	if not resp.Success then
		return false, "HTTP " .. tostring(resp.StatusCode)
	end
	local ok, json = pcall(function()
		return HttpService:JSONDecode(resp.Body)
	end)
	if not ok then
		return false, "Invalid JSON"
	end
	return true, json.results or {}
end

local function insertAsset(assetId, parentPath)
	local parent = workspace
	if parentPath then
		local resolved = resolveByFullName(parentPath)
		if resolved and resolved:IsA("Instance") then
			parent = resolved
		end
	end
	local ok, modelOrErr = pcall(function()
		local container = InsertService:LoadAsset(assetId)
		if not container then error("LoadAsset returned nil") end
		local model = container:FindFirstChildOfClass("Model") or container
		model.Parent = parent
		-- If the container is different from the inserted model, clean it up
		if container ~= model then pcall(function() container:Destroy() end) end
		return model
	end)
	if not ok then
		return false, modelOrErr
	end
	return true, modelOrErr
end

local function buildUI(gui)
    print("[Vector] building UI")
	gui:ClearAllChildren()
	gui.Title = "Vector"

	local root = Instance.new("Frame")
	root.Size = UDim2.new(1, 0, 1, 0)
	root.BackgroundTransparency = 1
	root.Parent = gui

    -- Small helper to style dark UI controls (Cursor-like)
    local function styleFrame(f)
        f.BackgroundTransparency = 0
        f.BackgroundColor3 = Color3.fromRGB(26, 26, 26)
        f.BorderSizePixel = 0
        local stroke = Instance.new("UIStroke")
        stroke.Color = Color3.fromRGB(60, 60, 60)
        stroke.Thickness = 1
        stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
        stroke.Parent = f
        local corner = Instance.new("UICorner")
        corner.CornerRadius = UDim.new(0, 6)
        corner.Parent = f
    end

    local function styleButton(b)
        b.BackgroundColor3 = Color3.fromRGB(38, 38, 38)
        b.TextColor3 = Color3.fromRGB(230, 230, 230)
        b.BorderSizePixel = 0
        b.Font = Enum.Font.Gotham
        b.TextSize = 14
        local stroke = Instance.new("UIStroke")
        stroke.Color = Color3.fromRGB(70, 70, 70)
        stroke.Thickness = 1
        stroke.Parent = b
        local corner = Instance.new("UICorner")
        corner.CornerRadius = UDim.new(0, 6)
        corner.Parent = b
    end

    local function styleInput(t)
        t.BackgroundColor3 = Color3.fromRGB(38, 38, 38)
        t.TextColor3 = Color3.fromRGB(235, 235, 235)
        t.PlaceholderColor3 = Color3.fromRGB(150, 150, 150)
        t.BorderSizePixel = 0
        t.Font = Enum.Font.Gotham
        t.TextSize = 15
        t.TextXAlignment = Enum.TextXAlignment.Left
        local stroke = Instance.new("UIStroke")
        stroke.Color = Color3.fromRGB(70, 70, 70)
        stroke.Thickness = 1
        stroke.Parent = t
        local corner = Instance.new("UICorner")
        corner.CornerRadius = UDim.new(0, 6)
        corner.Parent = t
    end

    local function styleChip(frame)
        frame.BackgroundColor3 = Color3.fromRGB(40, 40, 40)
        frame.BorderSizePixel = 0
        local corner = Instance.new("UICorner")
        corner.CornerRadius = UDim.new(0, 6)
        corner.Parent = frame
        local stroke = Instance.new("UIStroke")
        stroke.Color = Color3.fromRGB(70, 70, 70)
        stroke.Thickness = 1
        stroke.Parent = frame
    end

	local inputRow = Instance.new("Frame")
	inputRow.Name = "InputRow"
	-- Composer container: no outer border and auto-size vertically
	inputRow.Size = UDim2.new(1, -12, 0, 0)
	inputRow.AutomaticSize = Enum.AutomaticSize.Y
	inputRow.Position = UDim2.new(0, 6, 0, 6)
	inputRow.BackgroundTransparency = 1
	inputRow.BorderSizePixel = 0
	inputRow.Parent = root

    -- Rebuild composer as a compact card (Cursor-like), suited for sidebar widths
    inputRow:ClearAllChildren()
    local card = Instance.new("Frame")
    card.Name = "Composer"
    -- Inner card grows with content to avoid clipping
    card.Size = UDim2.new(1, 0, 0, 0)
    card.AutomaticSize = Enum.AutomaticSize.Y
    card.BackgroundTransparency = 0
    styleFrame(card)
    card.Parent = inputRow

    local padding = Instance.new("UIPadding")
    padding.PaddingTop = UDim.new(0, 8)
    padding.PaddingBottom = UDim.new(0, 8)
    padding.PaddingLeft = UDim.new(0, 8)
    padding.PaddingRight = UDim.new(0, 8)
    padding.Parent = card

    local vlist = Instance.new("UIListLayout")
    vlist.FillDirection = Enum.FillDirection.Vertical
    vlist.SortOrder = Enum.SortOrder.LayoutOrder
    vlist.Padding = UDim.new(0, 6)
    vlist.Parent = card

    -- Meta row (chips + percent placeholder)
    local meta = Instance.new("Frame")
    meta.Name = "Meta"
    meta.Size = UDim2.new(1, 0, 0, 20)
    meta.BackgroundTransparency = 1
    meta.LayoutOrder = 1
    meta.Parent = card
    local hlist = Instance.new("UIListLayout")
    hlist.FillDirection = Enum.FillDirection.Horizontal
    hlist.Padding = UDim.new(0, 6)
    hlist.SortOrder = Enum.SortOrder.LayoutOrder
    hlist.Parent = meta

    local chip1 = Instance.new("Frame")
    chip1.Size = UDim2.new(0, 24, 1, 0)
    styleChip(chip1)
    chip1.Parent = meta
    local c1 = Instance.new("TextLabel")
    c1.BackgroundTransparency = 1
    c1.Size = UDim2.new(1, 0, 1, 0)
    c1.Font = Enum.Font.Gotham
    c1.TextSize = 12
    c1.TextColor3 = Color3.fromRGB(200, 200, 200)
    c1.Text = "@"
    c1.Parent = chip1

    local chip2 = Instance.new("Frame")
    chip2.Size = UDim2.new(0, 60, 1, 0)
    styleChip(chip2)
    chip2.Parent = meta
    local c2 = Instance.new("TextLabel")
    c2.BackgroundTransparency = 1
    c2.Size = UDim2.new(1, -8, 1, 0)
    c2.Position = UDim2.new(0, 8, 0, 0)
    c2.TextXAlignment = Enum.TextXAlignment.Left
    c2.Font = Enum.Font.Gotham
    c2.TextSize = 12
    c2.TextColor3 = Color3.fromRGB(200, 200, 200)
    c2.Text = "1 Tab"
    c2.Parent = chip2

    -- Right-aligned chips (Retry/Next) using an inset container
    local spacer = Instance.new("Frame")
    spacer.BackgroundTransparency = 1
    spacer.Size = UDim2.new(1, -160, 1, 0)
    spacer.LayoutOrder = 2
    spacer.Parent = meta

    local retryBtn = Instance.new("TextButton")
    retryBtn.AutoButtonColor = true
    retryBtn.Size = UDim2.new(0, 56, 1, 0)
    retryBtn.Text = "Retry"
    styleChip(retryBtn)
    retryBtn.TextColor3 = Color3.fromRGB(200, 200, 200)
    retryBtn.Font = Enum.Font.Gotham
    retryBtn.TextSize = 12
    retryBtn.Parent = meta

    local nextBtn = Instance.new("TextButton")
    nextBtn.Size = UDim2.new(0, 52, 1, 0)
    nextBtn.Text = "Next"
    styleChip(nextBtn)
    nextBtn.TextColor3 = Color3.fromRGB(200, 200, 200)
    nextBtn.Font = Enum.Font.Gotham
    nextBtn.TextSize = 12
    nextBtn.Parent = meta

    -- Percent + spinner chip on the right
    local pctChip = Instance.new("Frame")
    pctChip.Size = UDim2.new(0, 62, 1, 0)
    styleChip(pctChip)
    pctChip.Parent = meta
    local pctLbl = Instance.new("TextLabel")
    pctLbl.BackgroundTransparency = 1
    pctLbl.Size = UDim2.new(1, -18, 1, 0)
    pctLbl.Position = UDim2.new(0, 6, 0, 0)
    pctLbl.TextXAlignment = Enum.TextXAlignment.Left
    pctLbl.Font = Enum.Font.Gotham
    pctLbl.TextSize = 12
    pctLbl.TextColor3 = Color3.fromRGB(200, 200, 200)
    pctLbl.Text = "0.0%"
    pctLbl.Parent = pctChip
    local spin = Instance.new("TextLabel")
    spin.BackgroundTransparency = 1
    spin.Size = UDim2.new(0, 12, 1, 0)
    spin.Position = UDim2.new(1, -14, 0, 0)
    spin.Font = Enum.Font.Gotham
    spin.TextSize = 12
    spin.TextColor3 = Color3.fromRGB(200, 200, 200)
    spin.Text = "◴"
    spin.Parent = pctChip
    task.spawn(function()
        local seq = {"◴","◷","◶","◵"}
        local i = 1
        while card.Parent do
            spin.Text = seq[i]
            i += 1; if i > #seq then i = 1 end
            task.wait(0.12)
        end
    end)

    -- Multiline input box
    local textBox = Instance.new("TextBox")
    textBox.LayoutOrder = 3
    textBox.MultiLine = true
    textBox.TextWrapped = true
    textBox.PlaceholderText = "Plan, search, build anything"
    textBox.Text = ""
    textBox.ClearTextOnFocus = false
    textBox.Size = UDim2.new(1, 0, 0, 90)
    styleInput(textBox)
    textBox.Parent = card

    -- Controls row: mode pill + model label + send circle
    local controls = Instance.new("Frame")
    controls.BackgroundTransparency = 1
    controls.Size = UDim2.new(1, 0, 0, 28)
    controls.LayoutOrder = 4
    controls.Parent = card
    local h2 = Instance.new("UIListLayout")
    h2.FillDirection = Enum.FillDirection.Horizontal
    h2.Padding = UDim.new(0, 8)
    h2.Parent = controls

    local autoBtn = Instance.new("TextButton")
    autoBtn.Size = UDim2.new(0, 64, 1, 0)
    autoBtn.Text = "Auto"
    styleChip(autoBtn)
    autoBtn.Parent = controls

    local modeBtn = Instance.new("TextButton")
    modeBtn.Size = UDim2.new(0, 84, 1, 0)
    modeBtn.Text = "Agent"
    styleChip(modeBtn)
    modeBtn.TextColor3 = Color3.fromRGB(200, 200, 200)
    modeBtn.Font = Enum.Font.Gotham
    modeBtn.TextSize = 12
    modeBtn.Parent = controls

    local modelBtn = Instance.new("TextButton")
    modelBtn.AutoButtonColor = false
    modelBtn.Active = false
    --modelBtn.TextXAlignment = Enum.TextXAlignment.Left --commented out to prevent it from being left aligned
    -- Adjust for Auto(64) + Mode(84) + Send(28) + 3 gaps(8 each) = 192 + small buffer
    modelBtn.Size = UDim2.new(1, -196, 1, 0)
    modelBtn.Text = "grok-code-fast-1"
    styleChip(modelBtn)
    modelBtn.TextColor3 = Color3.fromRGB(200, 200, 200)
    modelBtn.Font = Enum.Font.Gotham
    modelBtn.TextSize = 12
    modelBtn.Parent = controls

    local sendBtn = Instance.new("TextButton")
    sendBtn.Size = UDim2.new(0, 28, 1, 0)
    sendBtn.Text = "↑"
    styleChip(sendBtn)
    sendBtn.TextColor3 = Color3.fromRGB(200, 200, 200)
    sendBtn.Font = Enum.Font.Gotham
    sendBtn.TextSize = 14
    sendBtn.Parent = controls

    -- Model selection is managed by backend .env; keep label only

    -- Mode toggle
    local function setMode(m)
        CURRENT_MODE = (m == "ask") and "ask" or "agent"
        if CURRENT_MODE == "ask" then
            modeBtn.Text = "Ask"
        else
            modeBtn.Text = "Agent"
        end
    end
    setMode(CURRENT_MODE)
    modeBtn.MouseButton1Click:Connect(function()
        local m = (CURRENT_MODE == "agent") and "ask" or "agent"
        setMode(m)
    end)

    -- Auto toggle (apply proposals + continue automatically)
    _G.__VECTOR_AUTO = _G.__VECTOR_AUTO or false
    local function setAuto(v)
        _G.__VECTOR_AUTO = v and true or false
        autoBtn.Text = _G.__VECTOR_AUTO and "Auto ✓" or "Auto"
    end
    setAuto(_G.__VECTOR_AUTO)
    autoBtn.MouseButton1Click:Connect(function()
        setAuto(not _G.__VECTOR_AUTO)
    end)

    -- Initialize model label
    do modelBtn.Text = "server (.env)" end

	-- Status / Plan area (like Cursor). Reflowed below the composer
	local statusFrame = Instance.new("ScrollingFrame")
	statusFrame.Name = "Status"
    statusFrame.Size = UDim2.new(1, -12, 0, 100)
    statusFrame.Position = UDim2.new(0, 6, 0, 0) -- y set by reflow()
	statusFrame.CanvasSize = UDim2.new(0, 0, 0, 0)
	statusFrame.ScrollBarThickness = 6
	statusFrame.BackgroundTransparency = 0
	statusFrame.BackgroundColor3 = Color3.fromRGB(20, 20, 20)
	styleFrame(statusFrame)
	statusFrame.Parent = root

	local statusLayout = Instance.new("UIListLayout")
	statusLayout.SortOrder = Enum.SortOrder.LayoutOrder
	statusLayout.Padding = UDim.new(0, 2)
	statusLayout.Parent = statusFrame

	local list = Instance.new("ScrollingFrame")
	list.Name = "Proposals"
    list.Size = UDim2.new(1, -12, 1, 0) -- height set by reflow()
    list.Position = UDim2.new(0, 6, 0, 0) -- y set by reflow()
	list.CanvasSize = UDim2.new(0, 0, 0, 0)
	list.ScrollBarThickness = 8
	list.BackgroundTransparency = 1
	list.Parent = root

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 6)
	layout.Parent = list

    -- Reflow the vertical stack based on composer's height
    local function reflow()
        local composerH = inputRow.AbsoluteSize.Y
        local topAfterComposer = 6 + composerH + 6 -- top padding + composer + gap
        statusFrame.Position = UDim2.new(0, 6, 0, topAfterComposer)
        local statusH = statusFrame.Visible and statusFrame.Size.Y.Offset or 0
        local listTop = topAfterComposer + (statusH > 0 and (statusH + 6) or 0)
        list.Position = UDim2.new(0, 6, 0, listTop)
        -- Let the proposals list fill remaining space
        list.Size = UDim2.new(1, -12, 1, -(listTop + 6))
    end

    -- Responsive layout function
    local function applyResponsive(width)
        -- minimal widths tuned for sidebar; hide pieces when narrow
        local w = tonumber(width) or 300
        retryBtn.Visible = w >= 300
        nextBtn.Visible = w >= 300
        chip2.Visible = w >= 280
        modelBtn.Visible = w >= 280
        pctChip.Visible = w >= 260
        -- grow input when very narrow
        if w < 260 then textBox.Size = UDim2.new(1, 0, 0, 70) else textBox.Size = UDim2.new(1, 0, 0, 90) end
        reflow()
    end

    -- Keep layout correct as composer content grows/shrinks
    vlist:GetPropertyChangedSignal("AbsoluteContentSize"):Connect(function()
        task.defer(reflow)
    end)

    -- Hide status panel until the first chunk arrives
    statusFrame.Visible = false

    -- helper to append a status line immediately
    local function uiAddStatus(text)
        statusFrame.Visible = true
        local item = Instance.new("TextLabel")
        item.Size = UDim2.new(1, -8, 0, 18)
        item.TextXAlignment = Enum.TextXAlignment.Left
        item.BackgroundTransparency = 1
        item.TextColor3 = Color3.fromRGB(150, 150, 150)
        item.Text = tostring(text)
        item.Parent = statusFrame
        statusFrame.CanvasSize = UDim2.new(0, 0, 0, statusFrame.UIListLayout.AbsoluteContentSize.Y + 16)
        if _G.__VECTOR_UI and _G.__VECTOR_UI.reflow then _G.__VECTOR_UI.reflow() end
    end

    -- expose UI handles for outer code + progress updater
    local ui = {
        textBox = textBox,
        sendBtn = sendBtn,
        retryBtn = retryBtn,
        nextBtn = nextBtn,
        list = list,
        statusFrame = statusFrame,
        applyResponsive = applyResponsive,
        reflow = reflow,
        addStatus = uiAddStatus,
        setProgress = function(p)
            local v = math.max(0, math.min(100, tonumber(p) or 0))
            pctLbl.Text = string.format("%.1f%%", v)
        end,
    }
    _G.__VECTOR_UI = ui
    return ui
end

local function renderAssetResults(container, p, results)
	container:ClearAllChildren()
	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 4)
	layout.Parent = container
	for i, r in ipairs(results) do
		local row = Instance.new("Frame")
		row.Size = UDim2.new(1, -8, 0, 28)
		row.BackgroundTransparency = 0.4
		row.BackgroundColor3 = Color3.fromRGB(40, 40, 40)
		row.LayoutOrder = i
		row.Parent = container

		local xOffset = 8
		if r.thumbnailUrl then
			local img = Instance.new("ImageLabel")
			img.BackgroundTransparency = 1
			img.Size = UDim2.new(0, 24, 0, 24)
			img.Position = UDim2.new(0, 8, 0.5, -12)
			img.Image = tostring(r.thumbnailUrl)
			img.Parent = row
			xOffset = 8 + 24 + 6
		end

		local nameLbl = Instance.new("TextLabel")
		nameLbl.BackgroundTransparency = 1
		nameLbl.TextXAlignment = Enum.TextXAlignment.Left
		nameLbl.Size = UDim2.new(1, -160 - xOffset + 8, 1, 0)
		nameLbl.Position = UDim2.new(0, xOffset, 0, 0)
		nameLbl.Text = string.format("%s (id=%s)", tostring(r.name or "Asset"), tostring(r.id))
		nameLbl.Parent = row

		local insertBtn = Instance.new("TextButton")
		insertBtn.Text = "Insert"
		insertBtn.Size = UDim2.new(0, 80, 0, 22)
		insertBtn.Position = UDim2.new(1, -86, 0.5, -11)
		insertBtn.ZIndex = 2
		insertBtn.Parent = row

		insertBtn.MouseButton1Click:Connect(function()
			local ok, modelOrErr = insertAsset(r.id, p.insert and p.insert.parentPath or nil)
			if ok then
				row.BackgroundColor3 = Color3.fromRGB(32, 64, 32)
				row.BackgroundTransparency = 0.2
				reportApply(p.id, { ok = true, type = p.type, op = "insert_asset", assetId = r.id, insertedPath = modelOrErr:GetFullName() })
			else
				row.BackgroundColor3 = Color3.fromRGB(64, 32, 32)
				row.BackgroundTransparency = 0.2
				reportApply(p.id, { ok = false, type = p.type, op = "insert_asset", assetId = r.id, error = tostring(modelOrErr) })
			end
		end)
	end
end

local function renderProposals(list, proposals)
	for _, child in ipairs(list:GetChildren()) do
		if child:IsA("Frame") then child:Destroy() end
	end
	for i, p in ipairs(proposals) do
		local item = Instance.new("Frame")
		item.Size = UDim2.new(1, -8, 0, 84)
		item.BackgroundTransparency = 0.5
		item.BackgroundColor3 = Color3.fromRGB(34, 34, 34)
		item.LayoutOrder = i
		item.Parent = list

		local title = Instance.new("TextLabel")
		title.BackgroundTransparency = 1
		title.Font = Enum.Font.SourceSans
		title.TextSize = 18
		title.TextXAlignment = Enum.TextXAlignment.Left
		title.Size = UDim2.new(1, -8, 0, 24)
		title.Position = UDim2.new(0, 8, 0, 6)
		title.Text = summarizeProposal(p)
		title.Parent = item

		local snippet = Instance.new("TextLabel")
		snippet.BackgroundTransparency = 1
		snippet.TextXAlignment = Enum.TextXAlignment.Left
		snippet.TextYAlignment = Enum.TextYAlignment.Top
		snippet.Size = UDim2.new(1, -8, 0, 28)
		snippet.Position = UDim2.new(0, 8, 0, 30)
		snippet.TextWrapped = true
		if p.type == "edit" and p.preview and p.preview.unified then
			snippet.Text = string.sub(p.preview.unified, 1, 300)
		elseif p.type == "edit" and p.diff and p.diff.edits and p.diff.edits[1] then
			snippet.Text = "Insert: " .. string.sub(p.diff.edits[1].text or "", 1, 200)
		elseif p.type == "object_op" and p.ops and p.ops[1] and p.ops[1].op == "rename_instance" then
			snippet.Text = "Rename → " .. tostring(p.ops[1].newName)
		else
			snippet.Text = p.notes or ""
		end
		snippet.Parent = item

		local resultsFrame
		local browseBtn
		if p.type == "asset_op" and p.search then
			resultsFrame = Instance.new("Frame")
			resultsFrame.Size = UDim2.new(1, -8, 0, 100)
			resultsFrame.Position = UDim2.new(0, 8, 0, 60)
			resultsFrame.BackgroundTransparency = 0.6
			resultsFrame.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
			resultsFrame.Parent = item

			browseBtn = Instance.new("TextButton")
			browseBtn.Text = "Browse"
			browseBtn.Size = UDim2.new(0, 90, 0, 22)
			browseBtn.Position = UDim2.new(1, -98, 0, 6)
			browseBtn.Parent = item

			browseBtn.MouseButton1Click:Connect(function()
				browseBtn.Text = "Loading…"
				local ok, resultsOrErr = fetchAssets(p.search.query or "", p.search.limit or 8)
				if ok then
					renderAssetResults(resultsFrame, p, resultsOrErr)
					browseBtn.Text = "Refresh"
				else
					snippet.Text = "Asset search error: " .. tostring(resultsOrErr)
					browseBtn.Text = "Retry"
				end
			end)
		end

		local approve = Instance.new("TextButton")
		approve.Text = "Approve"
		approve.Size = UDim2.new(0, 90, 0, 22)
		approve.Position = UDim2.new(1, -196, 1, -28)
		approve.Parent = item

		local approveOpen
		local diffBtn
		local diffFrame
		if p.type == "edit" then
			approveOpen = Instance.new("TextButton")
			approveOpen.Text = "Apply & Open"
			approveOpen.Size = UDim2.new(0, 110, 0, 22)
			approveOpen.Position = UDim2.new(1, -314, 1, -28)
			approveOpen.Parent = item
			approve.Position = UDim2.new(1, -196, 1, -28)

			diffBtn = Instance.new("TextButton")
			diffBtn.Text = "Open Diff"
			diffBtn.Size = UDim2.new(0, 90, 0, 22)
			diffBtn.Position = UDim2.new(1, -404, 1, -28)
			diffBtn.Parent = item

			diffFrame = Instance.new("ScrollingFrame")
			diffFrame.Name = "Diff"
			diffFrame.Size = UDim2.new(1, -8, 0, 180)
			diffFrame.Position = UDim2.new(0, 8, 0, 60)
			diffFrame.Visible = false
			diffFrame.ScrollBarThickness = 8
			diffFrame.BackgroundTransparency = 0.6
			diffFrame.BackgroundColor3 = Color3.fromRGB(24, 24, 24)
			diffFrame.Parent = item

			diffBtn.MouseButton1Click:Connect(function()
				if not diffFrame.Visible then
					-- compute and render diff
					local inst = resolveByFullName(p.path)
					if not inst then
						snippet.Text = "Diff error: instance not found"
						return
					end
					local okOld, oldText = pcall(function() return ScriptEditorService:GetEditorSource(inst) end)
					if not okOld then
						snippet.Text = "Diff error: cannot read source"
						return
					end
					local newText = applyRangeEdits(oldText, p.diff.edits or {})
					renderUnifiedDiff(diffFrame, oldText, newText)
					diffFrame.Visible = true
					diffBtn.Text = "Close Diff"
					-- expand item height if needed
					item.Size = UDim2.new(1, -8, 0, 60 + 180 + 20)
				else
					diffFrame.Visible = false
					diffBtn.Text = "Open Diff"
					item.Size = UDim2.new(1, -8, 0, 84)
				end
			end)
		end

		local reject = Instance.new("TextButton")
		reject.Text = "Reject"
		reject.Size = UDim2.new(0, 90, 0, 22)
		reject.Position = UDim2.new(1, -98, 1, -28)
		reject.Parent = item

		if approveOpen then
			approveOpen.MouseButton1Click:Connect(function()
				local ok, err = applyEditProposal(p)
				title.Text = (ok and "✅ Applied " or "🔴 Failed ") .. summarizeProposal(p)
				if ok then openScriptByPath(p.path) else snippet.Text = tostring(err) end
				reportApply(p.id, { ok = ok, type = p.type, path = p.path, error = err, opened = ok })
			end)
		end

		approve.MouseButton1Click:Connect(function()
			if p.type == "edit" then
				local ok, err = applyEditProposal(p)
				title.Text = (ok and "✅ Applied " or "🔴 Failed ") .. summarizeProposal(p)
				if not ok then snippet.Text = tostring(err) end
				reportApply(p.id, { ok = ok, type = p.type, path = p.path, error = err })
			elseif p.type == "object_op" and p.ops then
				ensurePermissionWithStatus()
				local appliedAny = false
				local lastErr
				for _, op in ipairs(p.ops) do
					local ok, infoOrErr
					if op.op == "create_instance" then
						local res = ToolCreate(op.className, op.parentPath, op.props)
						ok = res and res.ok == true
						infoOrErr = res and (res.path or res.error)
						reportApply(p.id, { ok = ok, type = p.type, op = op.op, className = op.className, parentPath = op.parentPath, path = res and res.path, error = res and res.error })
					elseif op.op == "set_properties" then
						local res = ToolSetProps(op.path, op.props)
						ok = res and res.ok == true
						infoOrErr = (res and res.errors and #res.errors > 0) and HttpService:JSONEncode(res.errors) or (res and res.error)
						reportApply(p.id, { ok = ok, type = p.type, op = op.op, path = op.path, props = op.props, error = infoOrErr })
					elseif op.op == "rename_instance" then
						ok, infoOrErr = applyRenameOp(op)
						reportApply(p.id, { ok = ok, type = p.type, op = op.op, path = op.path, newName = op.newName, error = infoOrErr })
					elseif op.op == "delete_instance" then
						local res = ToolDelete(op.path)
						ok = res and res.ok == true
						infoOrErr = res and res.error
						reportApply(p.id, { ok = ok, type = p.type, op = op.op, path = op.path, error = infoOrErr })
					else
						ok = false
						infoOrErr = "Unknown op: " .. tostring(op.op)
						reportApply(p.id, { ok = false, type = p.type, op = tostring(op.op), error = infoOrErr })
					end
					appliedAny = appliedAny or ok
					if not ok and not lastErr then lastErr = infoOrErr end
				end
				title.Text = (appliedAny and "✅ Applied " or "🔴 Failed ") .. summarizeProposal(p)
				if not appliedAny and lastErr then snippet.Text = tostring(lastErr) end
			else
				title.Text = "ℹ️ Not implemented yet: " .. summarizeProposal(p)
				reportApply(p.id, { ok = false, type = p.type, reason = "not_implemented" })
			end
		end)

		reject.MouseButton1Click:Connect(function()
			item:Destroy()
		end)
	end
	list.CanvasSize = UDim2.new(0, 0, 0, list.UIListLayout.AbsoluteContentSize.Y + 16)
end

local function sendChat(projectId, message, ctx, workflowId, opts)
    local base = getBackendBaseUrl()
    local url = string.format("%s/api/chat", base)
    -- Provider settings now live in backend .env; omit provider in request
    local resp = Http.postJson(url, {
        projectId = projectId,
        message = message,
        context = ctx,
        provider = nil,
        workflowId = workflowId,
        mode = opts and opts.mode or nil,
        maxTurns = opts and opts.maxTurns or nil,
        enableFallbacks = opts and opts.enableFallbacks or nil,
    })
    return resp
end

print("[Vector] creating toolbar")

local toolbar = plugin:CreateToolbar("Vector")
local toggleButton = toolbar:CreateButton("Vector", "Open Vector chat", "")

print("[Vector] toolbar created")

local activePollers = {}
local gui = nil

local function appendStatus(container, text)
    -- Reveal the status panel on first chunk
    if container and container.Visible == false then
        container.Visible = true
        if _G.__VECTOR_UI and _G.__VECTOR_UI.reflow then
            pcall(function() _G.__VECTOR_UI.reflow() end)
        end
    end
    local item = Instance.new("TextLabel")
    item.Size = UDim2.new(1, -8, 0, 18)
    item.TextXAlignment = Enum.TextXAlignment.Left
    item.BackgroundTransparency = 1
    item.TextColor3 = Color3.fromRGB(140, 140, 140)
    item.Text = tostring(text)
    item.Parent = container
    container.CanvasSize = UDim2.new(0, 0, 0, container.UIListLayout.AbsoluteContentSize.Y + 16)
    -- Heuristic progress mapping for sidebar percent chip
    local line = tostring(text)
    local bump = nil
    if string.find(line, "planning:") then bump = 5 end
    if string.find(line, "provider.response") then bump = 60 end
    if string.find(line, "proposals.mapped") then bump = 90 end
    if string.find(line, "fallback") then bump = 40 end
    if bump then
        _G.__VECTOR_PROGRESS = math.max(_G.__VECTOR_PROGRESS or 0, bump)
        if _G.__VECTOR_UI and _G.__VECTOR_UI.setProgress then
            _G.__VECTOR_UI.setProgress(_G.__VECTOR_PROGRESS)
        end
    end
end

local function startStreamPoller(workflowId, statusContainer)
    if activePollers[workflowId] then return end
    activePollers[workflowId] = true
    task.spawn(function()
        local cursor = 0
        local base = getBackendBaseUrl()
        local idle = 0
        while activePollers[workflowId] do
            local url = string.format("%s/api/stream?workflowId=%s&cursor=%d", base, HttpService:UrlEncode(workflowId), cursor)
            local resp = Http.getJson(url)
            if not resp.Success then
                appendStatus(statusContainer, "stream error: HTTP " .. tostring(resp.StatusCode))
                break
            end
            local ok, js = pcall(function() return HttpService:JSONDecode(resp.Body) end)
            if ok and js and js.chunks then
                cursor = js.cursor or cursor
                local chunks = js.chunks
                if #chunks > 0 then idle = 0 end
                for _, line in ipairs(chunks) do appendStatus(statusContainer, line) end
            else
                idle += 1
            end
            if idle > 10 then break end -- stop after periods of inactivity
        end
        activePollers[workflowId] = nil
    end)
end


local function toggleDock()
	print("[Vector] toggleButton clicked")
	
	-- check if gui exists, if it does, toggle its visibility
	if gui then
		gui.Enabled = not gui.Enabled
		return
	end

	--otherwise, create a new one
	-- should be Enum.InitialDockState.Right, true, true, 320, 520, 260, 360
	local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, true, true, 320, 520, 260, 360)
	print("[Vector] info", info)
	gui = plugin:CreateDockWidgetPluginGui("VectorDock", info)
	gui.Title = "Vector"

	local ui = buildUI(gui)
	-- Responsive: reflow when the dock is resized
	pcall(function()
		gui:GetPropertyChangedSignal("AbsoluteSize"):Connect(function()
			if ui and ui.applyResponsive then ui.applyResponsive(gui.AbsoluteSize.X) end
		end)
		if ui and ui.applyResponsive then ui.applyResponsive(gui.AbsoluteSize.X) end
	end)

	task.defer(function()
		ensurePermissionWithStatus()
	end)

	local lastMessage = ""
	local lastCtx = nil
	local lastWorkflowId = nil

	-- Auto helpers
	local function autoApplyProposal(p)
		if p.type == "edit" then
			ui.addStatus("auto.apply edit → " .. (p.path or ""))
			ensurePermissionWithStatus()
			local ok, err = applyEditProposal(p)
			ui.addStatus(ok and "auto.ok" or ("auto.err " .. tostring(err)))
			reportApply(p.id, { ok = ok, type = p.type, path = p.path, error = err })
			return ok
		elseif p.type == "object_op" and p.ops then
			ensurePermissionWithStatus()
			local appliedAny = false
			for _, op in ipairs(p.ops) do
				if op.op == "create_instance" then
					ui.addStatus("auto.create " .. tostring(op.className) .. " under " .. tostring(op.parentPath))
					local res = ToolCreate(op.className, op.parentPath, op.props)
					appliedAny = appliedAny or (res and res.ok == true)
					reportApply(p.id, { ok = res and res.ok == true, type = p.type, op = op.op, className = op.className, parentPath = op.parentPath, path = res and res.path, error = res and res.error })
				elseif op.op == "set_properties" then
					ui.addStatus("auto.set_properties → " .. tostring(op.path))
					local res = ToolSetProps(op.path, op.props)
					local ok = res and res.ok == true
					appliedAny = appliedAny or ok
					local infoOrErr = (res and res.errors and #res.errors > 0) and HttpService:JSONEncode(res.errors) or (res and res.error)
					reportApply(p.id, { ok = ok, type = p.type, op = op.op, path = op.path, props = op.props, error = infoOrErr })
				elseif op.op == "rename_instance" then
					ui.addStatus("auto.rename → " .. tostring(op.path))
					local ok, infoOrErr = applyRenameOp(op)
					appliedAny = appliedAny or ok
					reportApply(p.id, { ok = ok, type = p.type, op = op.op, path = op.path, newName = op.newName, error = infoOrErr })
				elseif op.op == "delete_instance" then
					ui.addStatus("auto.delete → " .. tostring(op.path))
					local res = ToolDelete(op.path)
					local ok = res and res.ok == true
					appliedAny = appliedAny or ok
					reportApply(p.id, { ok = ok, type = p.type, op = op.op, path = op.path, error = res and res.error })
				end
			end
			return appliedAny
		elseif p.type == "asset_op" then
			ui.addStatus("auto.asset_op (skipped—requires user choice)")
			return false
		end
		return false
	end

	local function maybeAutoContinue(workflowId)
		if not _G.__VECTOR_AUTO then return end
		local maxSteps = 6
		local steps = 0
		task.spawn(function()
			while _G.__VECTOR_AUTO and steps < maxSteps do
				steps += 1
				ui.addStatus("auto.next step " .. tostring(steps))
				local followup = "Next step: propose exactly one small, safe action."
				local mode = CURRENT_MODE
				local opts = { mode = mode, maxTurns = (mode == "ask") and 1 or nil, enableFallbacks = true, modelOverride = nil }
				local resp = sendChat("local", followup, { activeScript = getActiveScriptContext(), selection = getSelectionContext() }, workflowId, opts)
				if not resp.Success then ui.addStatus("auto.http " .. tostring(resp.StatusCode)); break end
				local ok, parsed = pcall(function() return HttpService:JSONDecode(resp.Body) end)
				if not ok or parsed.error then ui.addStatus("auto.err invalid json"); break end
				renderProposals(ui.list, parsed.proposals or {})
				if parsed.workflowId then startStreamPoller(parsed.workflowId, ui.statusFrame) end
				local gotAny = false
				for _, proposal in ipairs(parsed.proposals or {}) do
					gotAny = true
					autoApplyProposal(proposal)
				end
				if not gotAny then break end
			end
			ui.addStatus("auto.done")
		end)
	end

	-- Extract send flow so both button and Enter key can trigger it
	local function runSend()
		-- echo user message in the plan/status area (Cursor-like transcript)
		ui.addStatus("You: " .. tostring(ui.textBox.Text))
		local ctx = {
			activeScript = getActiveScriptContext(),
			selection = getSelectionContext(),
		}
		lastMessage = ui.textBox.Text
		lastCtx = ctx
		-- Reset status view (and hide until we receive chunks)
		for _, child in ipairs(ui.statusFrame:GetChildren()) do
			if child:IsA("TextLabel") then child:Destroy() end
		end
		ui.statusFrame.Visible = false
		if ui.reflow then ui.reflow() end
		local mode = CURRENT_MODE
		local opts = {
			mode = mode,
			maxTurns = (mode == "ask") and 1 or nil,
			enableFallbacks = true,
			modelOverride = nil,
		}
		local resp = sendChat("local", ui.textBox.Text, ctx, nil, opts)
		if not resp.Success then
			local item = Instance.new("TextLabel")
			item.Size = UDim2.new(1, -8, 0, 48)
			item.TextWrapped = true
			item.Text = "HTTP " .. tostring(resp.StatusCode) .. ": " .. (resp.Body or "")
			item.BackgroundTransparency = 1
			item.Parent = ui.list
			return
		end
		local ok, parsed = pcall(function()
			return HttpService:JSONDecode(resp.Body)
		end)
		if not ok then
			local item = Instance.new("TextLabel")
			item.Size = UDim2.new(1, -8, 0, 24)
			item.Text = "Invalid JSON from server"
			item.BackgroundTransparency = 1
			item.Parent = ui.list
			return
		end
		if parsed.error then
			local item = Instance.new("TextLabel")
			item.Size = UDim2.new(1, -8, 0, 48)
			item.TextWrapped = true
			item.Text = "Error: " .. tostring(parsed.error)
			item.BackgroundTransparency = 1
			item.Parent = ui.list
			return
		end
		renderProposals(ui.list, parsed.proposals or {})
		if parsed.workflowId then
			lastWorkflowId = parsed.workflowId
			startStreamPoller(parsed.workflowId, ui.statusFrame)
		end
		if _G.__VECTOR_AUTO then
			for _, proposal in ipairs(parsed.proposals or {}) do autoApplyProposal(proposal) end
			if parsed.workflowId then maybeAutoContinue(parsed.workflowId) end
		end
	end

	ui.sendBtn.MouseButton1Click:Connect(runSend)

	-- Enter-to-Send: Enter sends, Shift+Enter inserts newline
	local enterConn: RBXScriptConnection? = nil
	ui.textBox.Focused:Connect(function()
		if enterConn then enterConn:Disconnect() end
		-- Bind directly to the TextBox to ensure we see Return even when Roblox marks it as game-processed
		enterConn = ui.textBox.InputBegan:Connect(function(input)
			if input.UserInputType == Enum.UserInputType.Keyboard and input.KeyCode == Enum.KeyCode.Return then
				local shift = UserInputService:IsKeyDown(Enum.KeyCode.LeftShift) or UserInputService:IsKeyDown(Enum.KeyCode.RightShift)
				if not shift then
					runSend()
					-- Trim a trailing newline if the TextBox inserted one
					ui.textBox.Text = string.gsub(ui.textBox.Text, "\r?\n$", "")
				end
			end
		end)
	end)
	ui.textBox.FocusLost:Connect(function(enterPressed)
		if enterPressed then
			-- Some Studio versions report enterPressed even for multi-line; treat as send
			runSend()
			ui.textBox.Text = string.gsub(ui.textBox.Text, "\r?\n$", "")
		end
		if enterConn then enterConn:Disconnect(); enterConn = nil end
	end)

	ui.retryBtn.MouseButton1Click:Connect(function()
		if lastMessage == "" then return end
		-- Re-run same prompt as a new workflow
		ui.sendBtn.Text = "Sending…"; ui.sendBtn.AutoButtonColor = false
		local mode = CURRENT_MODE
		local opts = { mode = mode, maxTurns = (mode == "ask") and 1 or nil, enableFallbacks = true, modelOverride = nil }
		local resp = sendChat("local", lastMessage, lastCtx, nil, opts)
		ui.sendBtn.Text = "Send"; ui.sendBtn.AutoButtonColor = true
		if not resp.Success then return end
		local ok, parsed = pcall(function() return HttpService:JSONDecode(resp.Body) end)
		if not ok or parsed.error then return end
		renderProposals(ui.list, parsed.proposals or {})
		if parsed.workflowId then
			lastWorkflowId = parsed.workflowId
			startStreamPoller(parsed.workflowId, ui.statusFrame)
		end
	end)

	ui.nextBtn.MouseButton1Click:Connect(function()
		if not lastWorkflowId then return end
		-- Ask the backend to continue with the next atomic step on the same workflow
		local followup = "Next step: propose exactly one small, safe action."
		local mode = CURRENT_MODE
		local opts = { mode = mode, maxTurns = (mode == "ask") and 1 or nil, enableFallbacks = true, modelOverride = nil }
		local resp = sendChat("local", followup, {
			activeScript = getActiveScriptContext(),
			selection = getSelectionContext(),
		}, lastWorkflowId, opts)
		if not resp.Success then return end
		local ok, parsed = pcall(function() return HttpService:JSONDecode(resp.Body) end)
		if not ok or parsed.error then return end
		renderProposals(ui.list, parsed.proposals or {})
		if parsed.workflowId then
			startStreamPoller(parsed.workflowId, ui.statusFrame)
		end
	end)
end

toggleButton.Click:Connect(toggleDock)

return {}
