local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ScriptEditorService = game:GetService("ScriptEditorService")

-- NOTE: In production, resolve path->Instance and merge edits to a final string before UpdateSourceAsync.
return function(scriptInstance, edits)
	if not ChangeHistoryService:TryBeginRecording("AI Edit", "AI Edit") then
		return { ok = false, error = "Cannot start recording" }
	end
	local ok, err = pcall(function()
		ScriptEditorService:UpdateSourceAsync(scriptInstance, function(old)
			return edits.__finalText or old
		end)
	end)
	ChangeHistoryService:FinishRecording("AI Edit")
	return { ok = ok, error = err }
end

