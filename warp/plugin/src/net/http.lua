local HttpService = game:GetService("HttpService")

local function postJson(url, body)
	return HttpService:RequestAsync({
		Url = url,
		Method = "POST",
		Headers = { ["Content-Type"] = "application/json" },
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

