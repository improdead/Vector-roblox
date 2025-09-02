local Selection = game:GetService("Selection")

-- Returns an array of { className, name, path }
return function()
    local out = {}
    for _, inst in ipairs(Selection:Get()) do
        table.insert(out, {
            className = inst.ClassName,
            name = inst.Name,
            path = inst:GetFullName(),
        })
    end
    return out
end

