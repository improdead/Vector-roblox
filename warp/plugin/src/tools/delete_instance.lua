local ChangeHistoryService = game:GetService("ChangeHistoryService")

local function resolveByFullName(path)
    if type(path) ~= "string" or #path == 0 then
        return nil
    end
    local tokens = string.split(path, ".")
    local i = 1
    if tokens[1] == "game" then i = 2 end
    local cur
    if tokens[i] then
        local ok, svc = pcall(function() return game:GetService(tokens[i]) end)
        if ok and svc then cur = svc else cur = game:FindFirstChild(tokens[i]) end
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

-- Deletes an instance. Returns { ok, error? }
return function(path)
    local inst = resolveByFullName(path)
    if not inst then
        return { ok = false, error = "Instance not found: " .. tostring(path) }
    end
    if not ChangeHistoryService:TryBeginRecording("Vector Delete", "Vector Delete") then
        return { ok = false, error = "Cannot start recording" }
    end
    local ok, err = pcall(function()
        inst.Parent = nil
    end)
    ChangeHistoryService:FinishRecording("Vector Delete")
    return { ok = ok, error = ok and nil or tostring(err) }
end

