-- Resolves a Roblox Instance from a canonical GetFullName()-style path (supports bracketed tokens)
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

local function serialize(v)
    local t = typeof(v)
    if t == "string" or t == "number" or t == "boolean" then return v end
    if t == "Instance" then
        local ok, full = pcall(function() return v:GetFullName() end)
        return { __t = "Instance", className = v.ClassName, name = v.Name, path = ok and full or v.Name }
    end
    if t == "Vector3" then return { __t = "Vector3", x = v.X, y = v.Y, z = v.Z } end
    if t == "Vector2" then return { __t = "Vector2", x = v.X, y = v.Y } end
    if t == "Color3" then return { __t = "Color3", r = v.R, g = v.G, b = v.B } end
    if t == "CFrame" then return { __t = "CFrame", comps = { v:GetComponents() } } end
    if t == "UDim2" then return { __t = "UDim2", xS = v.X.Scale, xO = v.X.Offset, yS = v.Y.Scale, yO = v.Y.Offset } end
    if t == "UDim" then return { __t = "UDim", s = v.Scale, o = v.Offset } end
    if t == "EnumItem" then return { __t = "EnumItem", enum = tostring(v.EnumType), name = v.Name, value = v.Value } end
    if t == "BrickColor" then return { __t = "BrickColor", name = v.Name, number = v.Number } end
    return tostring(v)
end

local DEFAULT_KEYS = {
    BasePart = { "Position", "Size", "Anchored", "Transparency", "Material", "Color" },
    Model = { "PrimaryPart", "WorldPivot" },
}

-- Returns a map of requested properties.
-- keys: array of property names; names starting with '@' fetch attributes.
-- opts: { includeAllAttributes?: boolean, maxBytes?: number }
return function(path, keys, opts)
    opts = opts or {}
    local maxBytes = opts.maxBytes or 32*1024
    local inst = resolveByFullName(path)
    local out = {}
    if not inst then return out end

    local list = keys
    if type(list) ~= "table" then
        list = DEFAULT_KEYS[inst.ClassName] or { "Name" }
    end

    local HttpService = game:GetService("HttpService")
    local total = 0
    for _, key in ipairs(list) do
        if type(key) == "string" and string.sub(key, 1, 1) == "@" then
            local attr = string.sub(key, 2)
            local v = inst:GetAttribute(attr)
            if v ~= nil then
                local sv = serialize(v)
                out["@" .. attr] = sv
                local ok, enc = pcall(function() return HttpService:JSONEncode(sv) end)
                total += ok and #enc or #tostring(sv)
            end
        else
            local ok, v = pcall(function() return inst[key] end)
            if ok then
                local sv = serialize(v)
                out[key] = sv
                local ok2, enc = pcall(function() return HttpService:JSONEncode(sv) end)
                total += ok2 and #enc or #tostring(sv)
            end
        end
        if total > maxBytes then break end
    end

    if opts.includeAllAttributes then
        local attrs = inst:GetAttributes()
        local acc = {}
        for k, v in pairs(attrs) do
            acc[k] = serialize(v)
            local ok, enc = pcall(function() return HttpService:JSONEncode(acc[k]) end)
            total += ok and #enc or #tostring(v)
            if total > maxBytes then break end
        end
        out["@attributes"] = acc
    end

    return out
end
