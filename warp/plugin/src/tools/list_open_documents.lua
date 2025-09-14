local StudioService = game:GetService("StudioService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local registry = {} -- path -> { path=..., isDirty=false, lastOpened=os.clock() }
local inited = false

local function pathOf(inst)
    if not inst then return nil end
    local ok, full = pcall(function() return inst:GetFullName() end)
    return ok and full or inst.Name
end

local function toScript(doc)
    if not doc then return nil end
    local s
    local ok = pcall(function()
        s = (doc.Script ~= nil) and doc.Script or (doc.GetScript and doc:GetScript())
    end)
    if ok then return s end
    return nil
end

local function init()
    if inited then return end
    inited = true
    -- Best-effort: connect if signals exist in this Studio version
    pcall(function()
        ScriptEditorService.TextDocumentDidOpen:Connect(function(doc)
            local s = toScript(doc)
            local p = pathOf(s)
            if p then
                registry[p] = { path = p, isDirty = false, lastOpened = os.clock() }
            end
        end)
    end)
    pcall(function()
        ScriptEditorService.TextDocumentDidChange:Connect(function(doc)
            local s = toScript(doc)
            local p = pathOf(s)
            if p then
                local rec = registry[p] or { path = p, isDirty = false, lastOpened = os.clock() }
                rec.isDirty = true
                rec.lastOpened = os.clock()
                registry[p] = rec
            end
        end)
    end)
    pcall(function()
        ScriptEditorService.TextDocumentDidClose:Connect(function(doc)
            local s = toScript(doc)
            local p = pathOf(s)
            if p then registry[p] = nil end
        end)
    end)
end

return function(maxCount)
    init()
    maxCount = maxCount or 20

    local arr = {}
    for _, v in pairs(registry) do table.insert(arr, v) end
    table.sort(arr, function(a,b) return a.lastOpened > b.lastOpened end)
    while #arr > maxCount do table.remove(arr) end

    -- Ensure at least the active script is represented
    if #arr == 0 then
        local s = StudioService.ActiveScript
        if s then
            local p = pathOf(s)
            table.insert(arr, { path = p, isDirty = true, lastOpened = os.clock() })
        end
    end
    return arr
end
