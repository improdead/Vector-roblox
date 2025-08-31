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

local function applyRenameOp(op)
	local inst = resolveByFullName(op.path)
	if not inst then
		return false, "Instance not found: " .. tostring(op.path)
	end
	if not ChangeHistoryService:TryBeginRecording("Vector Rename", "Vector Rename") then
		return false, "Cannot start recording"
	end
	local ok, err = pcall(function()
		inst.Name = op.newName
	end)
	ChangeHistoryService:FinishRecording("Vector Rename")
	return ok, err
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
		if p.type == "edit" and p.diff and p.diff.edits and p.diff.edits[1] then
			snippet.Text = "Insert: " .. string.sub(p.diff.edits[1].text or "", 1, 120)
		elseif p.type == "object_op" and p.ops and p.ops[1] and p.ops[1].op == "rename_instance" then
			snippet.Text = "Rename → " .. tostring(p.ops[1].newName)
		else
			snippet.Text = p.notes or ""
		end
		snippet.Parent = item

		local approve = Instance.new("TextButton")
		approve.Text = "Approve"
		approve.Size = UDim2.new(0, 90, 0, 22)
		approve.Position = UDim2.new(1, -196, 1, -28)
		approve.Parent = item

		local reject = Instance.new("TextButton")
		reject.Text = "Reject"
		reject.Size = UDim2.new(0, 90, 0, 22)
		reject.Position = UDim2.new(1, -98, 1, -28)
		reject.Parent = item

		approve.MouseButton1Click:Connect(function()
			if p.type == "edit" then
				local ok, err = applyEditProposal(p)
				title.Text = (ok and "✅ Applied " or "🔴 Failed ") .. summarizeProposal(p)
				if not ok then snippet.Text = tostring(err) end
			elseif p.type == "object_op" and p.ops then
				local appliedAny = false
				local lastErr
				for _, op in ipairs(p.ops) do
					if op.op == "rename_instance" then
						local ok, err = applyRenameOp(op)
						appliedAny = appliedAny or ok
						lastErr = lastErr or err
					end
				end
				title.Text = (appliedAny and "✅ Applied " or "🔴 Failed ") .. summarizeProposal(p)
				if not appliedAny and lastErr then snippet.Text = tostring(lastErr) end
			else
				title.Text = "ℹ️ Not implemented yet: " .. summarizeProposal(p)
			end
		end)

		reject.MouseButton1Click:Connect(function()
			item:Destroy()
		end)
	end
	list.CanvasSize = UDim2.new(0, 0, 0, list.UIListLayout.AbsoluteContentSize.Y + 16)
end

local function sendChat(projectId, message, ctx)
	local url = "http://127.0.0.1:3000/api/chat"
	local resp = Http.postJson(url, {
		projectId = projectId,
		message = message,
		context = ctx,
	})
	return resp
end

local toolbar = plugin:CreateToolbar("Vector")
local toggleButton = toolbar:CreateButton("Vector", "Open Vector chat", "")

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
			item.Size = UDim2.new(1, -8, 0, 24)
			item.Text = "HTTP error: " .. tostring(resp.StatusCode)
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
		renderProposals(list, parsed.proposals or {})
	end)
end)

return {}
