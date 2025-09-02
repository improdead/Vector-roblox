local Http = require(script.Parent.Parent.net.http)
local HttpService = game:GetService("HttpService")

-- Calls backend asset search and returns results array
return function(query, limit)
    local url = string.format(
        "http://127.0.0.1:3000/api/assets/search?query=%s&limit=%d",
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

