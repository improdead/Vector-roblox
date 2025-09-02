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

-- Returns array of { className, name, path } under a parent path
return function(parentPath)
    local parent = resolveByFullName(parentPath)
    local out = {}
    if not parent then return out end
    for _, child in ipairs(parent:GetChildren()) do
        table.insert(out, {
            className = child.ClassName,
            name = child.Name,
            path = child:GetFullName(),
        })
    end
    return out
end

