-- Resolves a Roblox Instance from a canonical GetFullName()-style path (supports bracketed/quoted tokens)
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

-- Returns array of { className, name, path } with optional opts
-- opts = { depth?: number (default 1), maxNodes?: number (default 200), classWhitelist?: { [ClassName]=true } }
return function(parentPath, opts)
    opts = opts or {}
    local depth = opts.depth or 2
    local maxNodes = opts.maxNodes or 200
    local filter = opts.classWhitelist

    local parent = resolveByFullName(parentPath)
    local out = {}
    if not parent or depth < 0 or maxNodes <= 0 then return out end

    local queue = { { inst = parent, d = 0 } }
    local seen = 0
    local step = 0
    while #queue > 0 do
        local cur = table.remove(queue, 1)
        if cur.d > 0 then
            local inst = cur.inst
            local ok, full = pcall(function() return inst:GetFullName() end)
            local item = { className = inst.ClassName, name = inst.Name, path = ok and full or inst.Name }
            if (not filter) or filter[item.className] then
                table.insert(out, item)
                seen += 1
                if seen >= maxNodes then break end
            end
        end
        if cur.d < depth then
            for _, child in ipairs(cur.inst:GetChildren()) do
                table.insert(queue, { inst = child, d = cur.d + 1 })
            end
        end
        step += 1
        if step % 200 == 0 then task.wait() end
    end
    return out
end
