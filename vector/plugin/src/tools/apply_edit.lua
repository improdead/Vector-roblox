local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local function isScriptClass(inst)
    local c = inst and inst.ClassName
    return c == "Script" or c == "LocalScript" or c == "ModuleScript"
end

-- Robust path resolver supporting game.Services and bracketed names ["Name.with.dots"]
local function resolveByFullName(path)
    if typeof(path) == "Instance" then return path end
    if typeof(path) ~= "string" or #path == 0 then return nil end

    local function unquote(s)
        if type(s) ~= "string" or #s < 2 then return s end
        local first = string.sub(s, 1, 1)
        local last = string.sub(s, -1, -1)
        if (first == '"' or first == "'") and last == first then
            return string.sub(s, 2, -2)
        end
        return s
    end

    local tokens = {}
    do
        local buf = {}
        local inBr = false
        for i = 1, #path do
            local ch = string.sub(path, i, i)
            if ch == "[" then
                inBr = true
            elseif ch == "]" then
                inBr = false
            elseif ch == "." and not inBr then
                table.insert(tokens, unquote(table.concat(buf)))
                buf = {}
            else
                table.insert(buf, ch)
            end
        end
        if #buf > 0 then table.insert(tokens, unquote(table.concat(buf))) end
    end

    local i = 1
    if tokens[1] == "game" then i += 1 end
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
        local name = tokens[i]
        cur = cur:FindFirstChild(name)
        if not cur then return nil end
        i += 1
    end
    return cur
end

-- line/column helpers
local function computeLineStarts(text)
    local starts = {1}
    for i = 1, #text do if string.byte(text, i) == 10 then table.insert(starts, i + 1) end end
    return starts
end
local function toOffset(text, line, col, lineStarts)
    local ls = lineStarts or computeLineStarts(text)
    local lineStart = ls[math.max(1, math.min(line, #ls))] or 1
    return lineStart + math.max(0, (col - 1))
end

local function applyRangeEdits(old, edits)
    local work = old
    local ls
    local norm = {}
    for _, e in ipairs(edits) do
        if e.start ~= nil and e["end"] ~= nil then
            -- offset-based (0-based) fallback
            local s = tonumber(e.start) or 0
            local en = tonumber(e["end"]) or s
            local a = s + 1
            local b_excl = en
            table.insert(norm, { a = a, b_excl = b_excl, text = e.text or "" })
        elseif e.startLine and e.startCol and e.endLine and e.endCol then
            ls = ls or computeLineStarts(work)
            local a = toOffset(work, e.startLine, e.startCol, ls)
            local b_excl = toOffset(work, e.endLine, e.endCol, ls) - 1
            table.insert(norm, { a = a, b_excl = b_excl, text = e.text or "" })
        end
    end
    table.sort(norm, function(p, q) return p.a > q.a end)
    for _, e in ipairs(norm) do
        local a = math.max(1, e.a)
        local b_excl = math.max(a - 1, e.b_excl or (a - 1))
        local left = string.sub(work, 1, a - 1)
        local right = string.sub(work, (b_excl + 1))
        work = left .. (e.text or "") .. right
    end
    return work
end

-- args: { script = Instance|string, edits = { __finalText? or array }, beforeHash?: string }
return function(args)
    local scriptOrPath = args and args.script
    local edits = args and args.edits
    local beforeHash = args and args.beforeHash

    local target = scriptOrPath
    if typeof(scriptOrPath) == "string" then
        target = resolveByFullName(scriptOrPath)
    end
    if not target or not isScriptClass(target) then
        return { ok = false, error = "Target is not a Script/LocalScript/ModuleScript", code = "INVALID_TARGET" }
    end
    if type(edits) ~= "table" then
        return { ok = false, error = "Missing or invalid edits", code = "INVALID_EDITS" }
    end

    local conflict = false
    local changed = false
    local errMsg

    if not ChangeHistoryService:TryBeginRecording("AI Edit", "AI Edit") then
        return { ok = false, error = "Cannot start recording", code = "CHS_BEGIN_FAIL" }
    end

    local ok, err = pcall(function()
        local function applyWith(old)
            -- Conflict check at call time to avoid require-order issues
            local sha1 = rawget(_G, "__VECTOR_SHA1")
            if beforeHash and type(sha1) == "function" then
                local h = sha1(old)
                if h ~= beforeHash then
                    conflict = true
                    return old, false
                end
            end

            local newText
            if edits.__finalText and type(edits.__finalText) == "string" then
                newText = edits.__finalText
            else
                newText = applyRangeEdits(old, edits)
            end

            if newText ~= old then
                changed = true
                return newText, true
            else
                return old, false
            end
        end

        -- Prefer UpdateSourceAsync if available
        local okAsync = pcall(function()
            ScriptEditorService:UpdateSourceAsync(target, function(old)
                local text, didChange = applyWith(old)
                return text
            end)
        end)
        if not okAsync then
            -- Fallback: GetEditorSource + SetEditorSource for older Studio versions
            local old = ScriptEditorService:GetEditorSource(target)
            local newText, didChange = applyWith(old)
            if didChange then
                ScriptEditorService:SetEditorSource(target, newText)
            end
        end
    end)

    ChangeHistoryService:FinishRecording("AI Edit")

    if not ok then errMsg = tostring(err) end

    return {
        ok = ok and not conflict and changed,
        conflict = conflict,
        changed = changed,
        error = errMsg,
        targetPath = target:GetFullName(),
    }
end
