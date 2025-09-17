local StudioService = game:GetService("StudioService")
local ScriptEditorService = game:GetService("ScriptEditorService")

return function()
	local s = StudioService.ActiveScript
	if not s then
		return { path = nil, text = nil, isDirty = false }
	end
	local ok, src = pcall(function()
		return ScriptEditorService:GetEditorSource(s)
	end)
	return { path = s:GetFullName(), text = ok and src or "", isDirty = true }
end

