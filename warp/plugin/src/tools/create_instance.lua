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

-- Creates an instance of className under parentPath and applies optional props.
-- Returns { ok, path?, error? }
return function(className, parentPath, props)
    if type(className) ~= "string" then
        return { ok = false, error = "Missing className" }
    end
    local parent = resolveByFullName(parentPath)
    if not parent then
        return { ok = false, error = "Parent not found: " .. tostring(parentPath) }
    end
    if not ChangeHistoryService:TryBeginRecording("Vector Create", "Vector Create") then
        return { ok = false, error = "Cannot start recording" }
    end
    local ok, res = pcall(function()
        local inst = Instance.new(className)
        if type(props) == "table" then
            for k, v in pairs(props) do
                pcall(function() inst[k] = v end)
            end
        end
        inst.Parent = parent
        return inst:GetFullName()
    end)
    ChangeHistoryService:FinishRecording("Vector Create")
    if ok then
        return { ok = true, path = res }
    else
        return { ok = false, error = tostring(res) }
    end
end

