local ScriptEditorService = game:GetService("ScriptEditorService")

local function clamp(n, minValue, maxValue)
    if n < minValue then return minValue end
    if n > maxValue then return maxValue end
    return n
end

local function safeGetFullName(inst)
    local ok, value = pcall(function()
        return inst:GetFullName()
    end)
    if ok and type(value) == "string" then
        return value
    end
    return inst.Name
end

local function safeGetSource(inst)
    local ok, value = pcall(function()
        if ScriptEditorService and ScriptEditorService.GetEditorSource then
            return ScriptEditorService:GetEditorSource(inst)
        end
        return inst.Source
    end)
    if ok and type(value) == "string" then
        return value
    end
    -- Final fallback to direct Source property access
    local okSource, src = pcall(function()
        return inst.Source
    end)
    if okSource and type(src) == "string" then
        return src
    end
    return nil
end

local function extractDefinitions(sourceText, scriptPath, maxLines, remainingBudget, out)
    if type(sourceText) ~= "string" or #sourceText == 0 then
        return remainingBudget
    end
    local count = remainingBudget
    local lineNumber = 0
    for line in string.gmatch(sourceText .. "\n", "(.-)\n") do
        lineNumber += 1
        if lineNumber > maxLines then
            break
        end
        for name in string.gmatch(line, "function%s+([%w_%.:]+)") do
            table.insert(out, {
                file = scriptPath,
                line = lineNumber,
                name = name,
            })
            count -= 1
            if count <= 0 then
                return 0
            end
        end
    end
    return count
end

return function(opts)
    opts = opts or {}
    local limit = clamp(tonumber(opts.limit) or 200, 1, 1000)
    local maxScripts = clamp(tonumber(opts.maxScripts) or 300, 1, 2000)
    local maxLines = clamp(tonumber(opts.maxLinesPerScript) or 2000, 1, 100000)

    local queue = { game }
    local head = 1
    local tail = 1
    local visited = { [game] = true }
    local results = {}
    local remaining = limit
    local scannedScripts = 0

    while head <= tail and remaining > 0 do
        local inst = queue[head]
        head += 1

        if inst:IsA("LuaSourceContainer") then
            scannedScripts += 1
            if scannedScripts > maxScripts then
                break
            end
            local path = safeGetFullName(inst)
            local source = safeGetSource(inst)
            remaining = extractDefinitions(source, path, maxLines, remaining, results)
        end

        if remaining <= 0 then
            break
        end

        local ok, children = pcall(function()
            return inst:GetChildren()
        end)
        if ok then
            for _, child in ipairs(children) do
                if not visited[child] then
                    visited[child] = true
                    tail += 1
                    queue[tail] = child
                end
            end
        end
    end

    return results
end
