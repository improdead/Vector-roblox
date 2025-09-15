local HttpService = game:GetService("HttpService")

local function postJson(url, body, extraHeaders)
	local headers = { ["Content-Type"] = "application/json" }
	if type(extraHeaders) == "table" then
		for k, v in pairs(extraHeaders) do
			headers[k] = v
		end
	end
	return HttpService:RequestAsync({
		Url = url,
		Method = "POST",
		Headers = headers,
		Body = HttpService:JSONEncode(body),
	})
end

local function getJson(url)
	return HttpService:RequestAsync({
		Url = url,
		Method = "GET",
		Headers = { ["Content-Type"] = "application/json" },
	})
end

return {
	postJson = postJson,
	getJson = getJson,
}
