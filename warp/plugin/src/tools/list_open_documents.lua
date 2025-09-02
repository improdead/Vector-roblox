local StudioService = game:GetService("StudioService")

-- Placeholder: Roblox APIs for enumerating open ScriptDocuments are limited.
-- Returns at least the active script as [{ path, isDirty }].
return function()
    local s = StudioService.ActiveScript
    local arr = {}
    if s then
        table.insert(arr, { path = s:GetFullName(), isDirty = true })
    end
    return arr
end

