# tools

Individual tool modules callable by the Vector system.

## Implemented Tools
- `apply_edit.lua`
- `create_instance.lua`
- `delete_instance.lua`
- `generate_asset_3d.lua`
- `get_active_script.lua`
- `get_properties.lua`
- `insert_asset.lua`
- `list_children.lua`
- `list_code_definition_names.lua`
- `list_open_documents.lua`
- `list_selection.lua`
- `rename_instance.lua`
- `search_assets.lua`
- `set_properties.lua`

## Conventions
- Each tool returns structured results (table) or errors with clear messages.
- Keep side-effects minimal and documented.
