-- Vector Plugin — minimal chat and proposal UI
-- - Collects context (active script + selection)
-- - Sends to /api/chat
-- - Renders proposals with Approve/Reject
-- - Applies simple edit insertions and rename_instance ops

local Http = require(script.Parent.net.http)
local HttpService = game:GetService("HttpService")
local StudioService = game:GetService("StudioService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local InsertService = game:GetService("InsertService")
local ToolCreate = require(script.Parent.tools.create_instance)
local ToolSetProps = require(script.Parent.tools.set_properties)
local ToolRename = require(script.Parent.tools.rename_instance)
local ToolDelete = require(script.Parent.tools.delete_instance)

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

local function resolveByFullName(path)
	if type(path) ~= "string" or #path == 0 then
		return nil
	end
	local tokens = string.split(path, ".")
	local i = 1
	if tokens[1] == "game" then
		i = 2
	end
	local cur
	if tokens[i] then
		local ok, svc = pcall(function()
			return game:GetService(tokens[i])
		end)
		if ok and svc then
			cur = svc
		else
			cur = game:FindFirstChild(tokens[i])
		end
		i += 1
	else
		cur = game
	end
	while cur and tokens[i] do
		local child = cur:FindFirstChild(tokens[i])
		if not child then
			return nil
		end
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
	if not ChangeHistoryService:TryBeginRecording("Vector Edit", "Vector Edit") then
		return false, "Cannot start recording"
	end
	local ok, err = pcall(function()
		ScriptEditorService:UpdateSourceAsync(inst, function()
			return newText
		end)
	end)
	ChangeHistoryService:FinishRecording("Vector Edit")
	return ok, err
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
    local val = plugin:GetSetting("vector_backend_base_url")
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
		local model = container
		local childModel = container and container:FindFirstChildOfClass("Model")
		if childModel then model = childModel end
		model.Parent = parent
		return model
	end)
	if not ok then
		return false, modelOrErr
	end
	return true, modelOrErr
end

local function buildUI(gui)
	gui:ClearAllChildren()
	gui.Title = "Vector"

	local root = Instance.new("Frame")
	root.Size = UDim2.new(1, 0, 1, 0)
	root.BackgroundTransparency = 1
	root.Parent = gui

	local inputRow = Instance.new("Frame")
	inputRow.Name = "InputRow"
	inputRow.Size = UDim2.new(1, -8, 0, 36)
	inputRow.Position = UDim2.new(0, 4, 0, 4)
	inputRow.BackgroundTransparency = 0.5
	inputRow.BackgroundColor3 = Color3.fromRGB(28, 28, 28)
	inputRow.Parent = root

	local textBox = Instance.new("TextBox")
	textBox.PlaceholderText = "Ask Vector…"
	textBox.Text = ""
	textBox.ClearTextOnFocus = false
	textBox.Size = UDim2.new(1, -84, 1, -8)
	textBox.Position = UDim2.new(0, 4, 0, 4)
	textBox.Parent = inputRow

	local sendBtn = Instance.new("TextButton")
	sendBtn.Text = "Send"
	sendBtn.Size = UDim2.new(0, 72, 1, -8)
	sendBtn.Position = UDim2.new(1, -76, 0, 4)
	sendBtn.Parent = inputRow

	local list = Instance.new("ScrollingFrame")
	list.Name = "Proposals"
	list.Size = UDim2.new(1, -8, 1, -48)
	list.Position = UDim2.new(0, 4, 0, 44)
	list.CanvasSize = UDim2.new(0, 0, 0, 0)
	list.ScrollBarThickness = 8
	list.BackgroundTransparency = 1
	list.Parent = root

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 6)
	layout.Parent = list

	return textBox, sendBtn, list
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

local function sendChat(projectId, message, ctx)
    local base = getBackendBaseUrl()
    local url = string.format("%s/api/chat", base)
    local settings = {
        baseUrl = plugin:GetSetting("vector_base_url"),
        apiKey = plugin:GetSetting("vector_api_key"),
        model = plugin:GetSetting("vector_model"),
    }
    local provider
    if typeof(settings.apiKey) == "string" and #settings.apiKey > 0 then
        provider = {
            name = "openrouter",
            baseUrl = typeof(settings.baseUrl) == "string" and settings.baseUrl or "https://openrouter.ai/api/v1",
            apiKey = settings.apiKey,
            model = typeof(settings.model) == "string" and settings.model or "moonshotai/kimi-k2:free",
        }
    end

    local resp = Http.postJson(url, {
        projectId = projectId,
        message = message,
        context = ctx,
        provider = provider,
    })
    return resp
end

local toolbar = plugin:CreateToolbar("Vector")
local toggleButton = toolbar:CreateButton("Vector", "Open Vector chat", "")
local settingsButton = toolbar:CreateButton("Vector Settings", "Configure provider settings", "")

local activePollers = {}

local function appendStatus(list, text)
    local item = Instance.new("TextLabel")
    item.Size = UDim2.new(1, -8, 0, 18)
    item.TextXAlignment = Enum.TextXAlignment.Left
    item.BackgroundTransparency = 1
    item.TextColor3 = Color3.fromRGB(140, 140, 140)
    item.Text = tostring(text)
    item.Parent = list
    list.CanvasSize = UDim2.new(0, 0, 0, list.UIListLayout.AbsoluteContentSize.Y + 16)
end

local function startStreamPoller(workflowId, list)
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
                appendStatus(list, "stream error: HTTP " .. tostring(resp.StatusCode))
                break
            end
            local ok, js = pcall(function() return HttpService:JSONDecode(resp.Body) end)
            if ok and js and js.chunks then
                cursor = js.cursor or cursor
                local chunks = js.chunks
                if #chunks > 0 then idle = 0 end
                for _, line in ipairs(chunks) do appendStatus(list, line) end
            else
                idle += 1
            end
            if idle > 10 then break end -- stop after periods of inactivity
        end
        activePollers[workflowId] = nil
    end)
end

toggleButton.Click:Connect(function()
	local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Left, true, false, 360, 480, 240, 320)
	local gui = plugin:CreateDockWidgetPluginGui("VectorDock", info)
	gui.Title = "Vector"

	local input, sendBtn, list = buildUI(gui)

	sendBtn.MouseButton1Click:Connect(function()
		local ctx = {
			activeScript = getActiveScriptContext(),
			selection = getSelectionContext(),
		}
		local resp = sendChat("local", input.Text, ctx)
    if not resp.Success then
        local item = Instance.new("TextLabel")
        item.Size = UDim2.new(1, -8, 0, 48)
        item.TextWrapped = true
        item.Text = "HTTP " .. tostring(resp.StatusCode) .. ": " .. (resp.Body or "")
        item.BackgroundTransparency = 1
        item.Parent = list
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
        item.Parent = list
        return
    end
    if parsed.error then
        local item = Instance.new("TextLabel")
        item.Size = UDim2.new(1, -8, 0, 48)
        item.TextWrapped = true
        item.Text = "Error: " .. tostring(parsed.error)
        item.BackgroundTransparency = 1
        item.Parent = list
        return
    end
    renderProposals(list, parsed.proposals or {})
    if parsed.workflowId then
        startStreamPoller(parsed.workflowId, list)
    end
	end)
end)

-- Settings UI (API Provider)
local function loadProviderSettings()
    local baseUrl = plugin:GetSetting("vector_base_url")
    local apiKey = plugin:GetSetting("vector_api_key")
    local model = plugin:GetSetting("vector_model")
    local backend = plugin:GetSetting("vector_backend_base_url")
    return {
        baseUrl = typeof(baseUrl) == "string" and baseUrl or "https://openrouter.ai/api/v1",
        apiKey = typeof(apiKey) == "string" and apiKey or "",
        model = typeof(model) == "string" and model or "moonshotai/kimi-k2:free",
        backend = typeof(backend) == "string" and backend or "http://127.0.0.1:3000",
    }
end

local function saveProviderSettings(s)
    if s.baseUrl then plugin:SetSetting("vector_base_url", s.baseUrl) end
    if s.apiKey ~= nil then plugin:SetSetting("vector_api_key", s.apiKey) end
    if s.model then plugin:SetSetting("vector_model", s.model) end
    if s.backend then plugin:SetSetting("vector_backend_base_url", s.backend) end
end

local function openSettings()
    local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, true, false, 420, 360, 360, 300)
    local gui = plugin:CreateDockWidgetPluginGui("VectorSettings", info)
    gui.Title = "Vector Settings"

    local root = Instance.new("Frame")
    root.Size = UDim2.new(1, 0, 1, 0)
    root.BackgroundTransparency = 1
    root.Parent = gui

    local function mkLabel(text, y)
        local l = Instance.new("TextLabel")
        l.Text = text
        l.TextXAlignment = Enum.TextXAlignment.Left
        l.BackgroundTransparency = 1
        l.Position = UDim2.new(0, 12, 0, y)
        l.Size = UDim2.new(1, -24, 0, 20)
        l.Parent = root
        return l
    end
    local function mkInput(y)
        local t = Instance.new("TextBox")
        t.Size = UDim2.new(1, -24, 0, 28)
        t.Position = UDim2.new(0, 12, 0, y)
        t.BackgroundColor3 = Color3.fromRGB(36, 36, 36)
        t.TextXAlignment = Enum.TextXAlignment.Left
        t.Text = ""
        t.ClearTextOnFocus = false
        t.Parent = root
        return t
    end

    local cfg = loadProviderSettings()
    mkLabel("API Provider: OpenAI Compatible (OpenRouter)", 12)
    mkLabel("Base URL", 42)
    local baseInput = mkInput(62)
    baseInput.Text = cfg.baseUrl

    mkLabel("API Key", 98)
    local keyInput = mkInput(118)
    keyInput.Text = cfg.apiKey

    mkLabel("Model ID", 154)
    local modelInput = mkInput(174)
    modelInput.Text = cfg.model

    mkLabel("Backend Base URL (Next.js)", 210)
    local backendInput = mkInput(230)
    backendInput.Text = cfg.backend

    local saveBtn = Instance.new("TextButton")
    saveBtn.Text = "Done"
    saveBtn.Size = UDim2.new(0, 96, 0, 28)
    saveBtn.Position = UDim2.new(1, -108, 1, -40)
    saveBtn.Parent = root
    saveBtn.MouseButton1Click:Connect(function()
        saveProviderSettings({ baseUrl = baseInput.Text, apiKey = keyInput.Text, model = modelInput.Text, backend = backendInput.Text })
        gui.Enabled = false
        gui:Destroy()
    end)
end

settingsButton.Click:Connect(function()
    openSettings()
end)

return {}
