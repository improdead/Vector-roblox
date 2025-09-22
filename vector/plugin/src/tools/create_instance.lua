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

local function deserialize(v)
    if type(v) ~= "table" or v.__t == nil then return v end
    local t = v.__t
    if t == "Vector3" then return Vector3.new(v.x or 0, v.y or 0, v.z or 0) end
    if t == "Vector2" then return Vector2.new(v.x or 0, v.y or 0) end
    if t == "Color3" then return Color3.new(v.r or 0, v.g or 0, v.b or 0) end
    if t == "UDim" then
        local s = v.s ~= nil and v.s or v.scale
        local o = v.o ~= nil and v.o or v.offset
        return UDim.new(s or 0, o or 0)
    end
    if t == "UDim2" then
        local xS = v.xS; local xO = v.xO; local yS = v.yS; local yO = v.yO
        if v.x and type(v.x) == "table" then xS = v.x.scale or v.x.s or xS; xO = v.x.offset or v.x.o or xO end
        if v.y and type(v.y) == "table" then yS = v.y.scale or v.y.s or yS; yO = v.y.offset or v.y.o or yO end
        return UDim2.new(xS or 0, xO or 0, yS or 0, yO or 0)
    end
    if t == "CFrame" then
        local comps = v.comps or {}
        if type(comps) == "table" and #comps >= 12 then
            return CFrame.new(table.unpack(comps))
        end
        return CFrame.new()
    end
    if t == "EnumItem" then
        local enumStr = v.enum or ""
        local enumName = string.match(enumStr, "^Enum%.(.+)$") or enumStr
        local name = v.name
        local value = v.value
        local ok, enumType = pcall(function() return Enum[enumName] end)
        if ok and enumType then
            if name and enumType[name] then
                return enumType[name]
            end
            if value ~= nil then
                local items = enumType:GetEnumItems()
                for _, item in ipairs(items) do
                    if item.Value == value then return item end
                end
            end
        end
        return nil
    end
    if t == "BrickColor" then
        if v.number ~= nil then return BrickColor.new(v.number) end
        if v.name ~= nil then return BrickColor.new(v.name) end
        return BrickColor.White()
    end
    if t == "Instance" then
        if v.path then return resolveByFullName(v.path) end
        return nil
    end
    return v
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
    local startedRecording = ChangeHistoryService:TryBeginRecording("Vector Create", "Vector Create")
    local ok, res = pcall(function()
        local inst = Instance.new(className)
        if type(props) == "table" then
            for k, v in pairs(props) do
                if type(k) == "string" and string.sub(k,1,1) == "@" then
                    local attr = string.sub(k,2)
                    local dv = deserialize(v)
                    if not (dv == nil and type(v) == "table" and v.__t == "Instance") then
                        pcall(function() inst:SetAttribute(attr, dv) end)
                    end
                else
                    pcall(function() inst[k] = deserialize(v) end)
                end
            end
        end
        inst.Parent = parent
        return inst:GetFullName()
    end)
    if startedRecording then
        ChangeHistoryService:FinishRecording("Vector Create")
    end
    if ok then
        return { ok = true, path = res }
    else
        -- If recording was denied earlier, report a clearer message
        if not startedRecording and tostring(res) == "Cannot start recording" then
            return { ok = false, error = "Cannot start recording" }
        end
        return { ok = false, error = tostring(res) }
    end
end
