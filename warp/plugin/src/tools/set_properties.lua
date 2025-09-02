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

-- Sets properties on an instance. Returns { ok, errors? }
return function(path, props)
    local inst = resolveByFullName(path)
    if not inst then
        return { ok = false, error = "Instance not found: " .. tostring(path) }
    end
    if type(props) ~= "table" then
        return { ok = false, error = "Invalid props" }
    end
    if not ChangeHistoryService:TryBeginRecording("Vector Set Properties", "Vector Set Properties") then
        return { ok = false, error = "Cannot start recording" }
    end
    local errors = {}
    for k, v in pairs(props) do
        local okSet, err = pcall(function() inst[k] = v end)
        if not okSet then table.insert(errors, { key = k, error = tostring(err) }) end
    end
    ChangeHistoryService:FinishRecording("Vector Set Properties")
    return { ok = #errors == 0, errors = (#errors > 0) and errors or nil }
end

