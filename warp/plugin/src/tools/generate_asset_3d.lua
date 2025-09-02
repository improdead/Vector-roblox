local Http = require(script.Parent.Parent.net.http)
local HttpService = game:GetService("HttpService")

-- Enqueues a 3D generation job on the backend. Returns { ok, jobId?, error? }
return function(prompt, opts)
    local body = { prompt = prompt, tags = opts and opts.tags or nil, style = opts and opts.style or nil, budget = opts and opts.budget or nil }
    local resp = Http.postJson("http://127.0.0.1:3000/api/assets/generate3d", body)
    if not resp.Success then
        return { ok = false, error = "HTTP " .. tostring(resp.StatusCode) }
    end
    local ok, js = pcall(function() return HttpService:JSONDecode(resp.Body) end)
    if not ok then
        return { ok = false, error = "Invalid JSON" }
    end
    return { ok = true, jobId = js.jobId }
end

