local InsertService = game:GetService("InsertService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local function resolveByFullName(path)
    if typeof(path) == "Instance" then return path end
    if typeof(path) ~= "string" or #path == 0 then return nil end
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

return function(assetId, parent)
    local parentInst = parent and resolveByFullName(parent) or workspace
    if not parentInst then
        return { ok = false, error = "Parent not found" }
    end
    if not ChangeHistoryService:TryBeginRecording("Vector Insert Asset", "Vector Insert Asset") then
        return { ok = false, error = "Cannot start recording" }
    end
    local ok, res = pcall(function()
        local container = InsertService:LoadAsset(assetId)
        if not container then error("LoadAsset returned nil") end
        local model = container:FindFirstChildOfClass("Model") or container
        model.Parent = parentInst
        local path = model:GetFullName()
        -- Destroy the container if it is different from the placed model
        if container ~= model then pcall(function() container:Destroy() end) end
        return { ok = true, insertedPaths = { path } }
    end)
    ChangeHistoryService:FinishRecording("Vector Insert Asset")
    if ok then return res else return { ok = false, error = tostring(res) } end
end
