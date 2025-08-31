local InsertService = game:GetService("InsertService")

return function(assetId, parent)
	local container = InsertService:LoadAsset(assetId)
	local model = container
	local childModel = container and container:FindFirstChildOfClass("Model")
	if childModel then
		model = childModel
	end
	if parent then
		model.Parent = parent
	else
		model.Parent = workspace
	end
	return { insertedPaths = { model:GetFullName() } }
end

