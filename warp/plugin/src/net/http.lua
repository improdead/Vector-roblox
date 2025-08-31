local HttpService = game:GetService("HttpService")

local function postJson(url, body)
	return HttpService:RequestAsync({
		Url = url,
		Method = "POST",
		Headers = { ["Content-Type"] = "application/json" },
		Body = HttpService:JSONEncode(body),
	})
end

return {
	postJson = postJson,
}

