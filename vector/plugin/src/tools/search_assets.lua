local Http = require(script.Parent.Parent.net.http)
local HttpService = game:GetService("HttpService")

local function getBackendBaseUrl()
    local val = plugin and plugin:GetSetting and plugin:GetSetting("vector_backend_base_url")
    if typeof(val) == "string" and #val > 0 then
        return (string.sub(val, -1) == "/") and string.sub(val, 1, -2) or val
    end
    return "http://127.0.0.1:3000"
end

-- Calls backend asset search and returns results array
return function(query, limit)
    local base = getBackendBaseUrl()
    local url = string.format(
        "%s/api/assets/search?query=%s&limit=%d",
        base,
        HttpService:UrlEncode(query or ""),
        tonumber(limit) or 8
    )
    local resp = Http.getJson(url)
    if not resp.Success then
        return { ok = false, error = "HTTP " .. tostring(resp.StatusCode) }
    end
    local ok, js = pcall(function() return HttpService:JSONDecode(resp.Body) end)
    if not ok then
        return { ok = false, error = "Invalid JSON" }
    end
    return { ok = true, results = js.results or {} }
end
