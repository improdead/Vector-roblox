-- Resolves a Roblox Instance from a canonical GetFullName()-style path
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

local function serialize(val)
    local t = typeof(val)
    if t == "string" or t == "number" or t == "boolean" then
        return val
    end
    -- Convert complex Roblox types to strings for JSON safety
    return tostring(val)
end

-- Returns a map of requested properties. If keys is nil, returns empty map.
return function(path, keys)
    local inst = resolveByFullName(path)
    local out = {}
    if not inst or type(keys) ~= "table" then return out end
    for _, key in ipairs(keys) do
        local ok, v = pcall(function() return inst[key] end)
        if ok then out[key] = serialize(v) end
    end
    return out
end

