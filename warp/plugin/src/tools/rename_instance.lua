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

-- Renames an instance. Returns { ok, path?, error? }
return function(path, newName)
    local inst = resolveByFullName(path)
    if not inst then
        return { ok = false, error = "Instance not found: " .. tostring(path) }
    end
    if type(newName) ~= "string" or #newName == 0 then
        return { ok = false, error = "Invalid newName" }
    end
    if not ChangeHistoryService:TryBeginRecording("Vector Rename", "Vector Rename") then
        return { ok = false, error = "Cannot start recording" }
    end
    local ok, err = pcall(function() inst.Name = newName end)
    ChangeHistoryService:FinishRecording("Vector Rename")
    if ok then
        return { ok = true, path = inst:GetFullName() }
    else
        return { ok = false, error = tostring(err) }
    end
end

