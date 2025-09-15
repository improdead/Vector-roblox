local ChangeHistoryService = game:GetService("ChangeHistoryService")

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
