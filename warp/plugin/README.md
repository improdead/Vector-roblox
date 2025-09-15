# Vector Plugin for Roblox Studio

This is the Roblox Studio plugin component of Vector, an AI-powered copilot for Roblox development. The plugin provides a chat interface within Studio and executes AI-proposed changes safely with user approval.

## How It Works

The plugin acts as the "hands" of the Vector system:

1. **UI Layer**: Provides a docked chat interface in Roblox Studio
2. **Context Collection**: Gathers information about your current Studio state (active scripts, selection, open documents)
3. **Proposal Rendering**: Displays AI-suggested changes as preview cards with approve/reject buttons
4. **Safe Execution**: Applies approved changes using Roblox's ChangeHistoryService for proper undo support
5. **Backend Communication**: Communicates with the Next.js backend via HTTP requests

## Architecture

```
plugin/
├── src/
│   ├── main.server.lua           # Main plugin entry point & UI
│   ├── net/
│   │   └── http.lua              # HTTP utilities for backend communication
│   └── tools/                    # Individual tool implementations
│       ├── get_active_script.lua # Context: Get current script
│       ├── list_selection.lua    # Context: Get selected objects
│       ├── apply_edit.lua        # Edit: Apply text changes to scripts
│       ├── create_instance.lua   # Object: Create new instances
│       ├── set_properties.lua    # Object: Modify instance properties
│       ├── rename_instance.lua   # Object: Rename instances
│       ├── delete_instance.lua   # Object: Delete instances
│       ├── search_assets.lua     # Asset: Search Roblox catalog
│       ├── insert_asset.lua      # Asset: Insert catalog assets
│       └── generate_asset_3d.lua # Asset: Generate 3D assets (via API)
├── plugin.project.json           # Rojo project for plugin build
├── rojo.json                     # Alternative Rojo config
├── selene.toml                   # Lua linter configuration
└── stylua.toml                   # Lua formatter configuration
```

## Prerequisites

1. **Roblox Studio** (latest version recommended)
2. **Rojo** for syncing code to Studio
   ```bash
   cargo install rojo
   # or via Foreman: foreman install
   ```
3. **Backend Running**: The Next.js backend must be running on `http://127.0.0.1:3000`
   ```bash
   cd ../apps/web
   npm run dev
   ```

## Quick Start

### Method 1: Plugin File Installation

1. **Build and Copy Plugin**:
   ```bash
   cd warp/plugin
   rojo build plugin.project.json -o Vector.rbxmx && cp Vector.rbxmx <path-to-roblox-plugins-folder>
   ```

2. **Install in Studio**:
   - Open/Restart Roblox Studio
   - Look for **Vector** in the toolbar
   - Click on it to open Chat.

## First Test Run

1. **Start the Backend** (if not already running):
   ```bash
   cd ../apps/web
   npm install
   npm run dev
   ```

2. **Open Studio Project**:
   - Create a new place or open an existing one
   - Open a script (ServerScript, LocalScript, or ModuleScript)

3. **Open Vector**:
   - Click the **Vector** button in the toolbar
   - A dock should appear on the right side

4. **Test Basic Functionality**:
   ```
   Try these commands in the chat:
   
   # Simple rename test
   "Rename the selected part to 'TestPart'"
   
   # Simple edit test (with a script open)
   "Add a comment at the top of this script"
   
   # Object creation test
   "Create a red part in workspace"
   
   # Asset search test
   "Search for tree models"
   ```

5. **Verify Permissions**:
   - On first HTTP request: Studio will prompt for **HTTP domain permission** → Allow
   - On first script edit: Studio will prompt for **Script Modification** → Allow

## Development Workflow

### Code Quality Tools

```bash
# Format code
stylua src/

# Lint code (requires selene: https://github.com/Kampfkarren/selene)
selene src/

# Type checking (requires luau-lsp)
luau-lsp --check src/
```

## Configuration

### Backend URL
The plugin is hardcoded to connect to `http://127.0.0.1:3000`. To change this:

```lua
-- In src/main.server.lua, modify:
local function getBackendBaseUrl()
    return "http://127.0.0.1:3000"  -- Change this URL
end
```

### Plugin Settings
The plugin stores minimal settings in Studio. Most configuration is handled by the backend environment variables.

## Key Features

### Safety Systems
- **Approval Gates**: Every change requires explicit user approval
- **Undo Integration**: All changes create proper undo steps via ChangeHistoryService
- **Edit Conflict Detection**: SHA-1 hashing prevents applying stale edits
- **Validation**: Multiple layers of input validation

### UI Features
- **Responsive Design**: Adapts to different dock widths
- **Real-time Status**: Streaming progress updates during AI processing
- **Diff Previews**: Visual diffs for script changes
- **Auto Mode**: Can automatically apply proposals and continue workflows

### Tool System
Each tool in `src/tools/` corresponds to an AI capability:
- **Context Tools**: Gather information (non-destructive)
- **Edit Tools**: Modify script content
- **Object Tools**: Create/modify/delete Roblox instances
- **Asset Tools**: Search and insert from catalog

## Troubleshooting

### Common Issues

**Plugin doesn't appear in toolbar**:
- Check if Rojo is connected and syncing
- Verify the plugin has `RunContext: Plugin` in main.server.lua
- Try restarting Studio

**HTTP permission errors**:
- Studio will prompt for HTTP access on first request
- Must allow `http://127.0.0.1:3000` domain
- Check if backend is running on port 3000

**"No proposals" or empty responses**:
- Check backend console for errors
- Verify environment variables in backend `.env.local`
- Test with simple commands first

**Script modification blocked**:
- Studio requires Script Modification permission
- Will prompt on first edit attempt
- Must approve to allow code changes

**Rojo connection failed**:
```bash
# Check if port 34872 is in use
netstat -an | grep 34872

# Try alternative port
rojo serve plugin.project.json --port 34873
```

### Debug Mode

Add debug logging to any tool:
```lua
-- At the top of any tool file
local function debug(...)
    print("[Vector Debug]", ...)
end

-- Use throughout the code
debug("Tool called with args:", args)
```

### Network Debugging

Monitor HTTP requests:
```lua
-- In src/net/http.lua, add logging
local function postJson(url, body, extraHeaders)
    print("[Vector HTTP POST]", url)
    print("[Vector HTTP BODY]", HttpService:JSONEncode(body))
    -- ... rest of function
end
```

## Building for Distribution

### Create Plugin File
```bash
# Build standalone plugin
rojo build plugin.project.json -o Vector.rbxm

# The .rbxm file can be distributed to other developers
# They can install it by copying to their plugins folder
```

### Publishing to Marketplace
1. Build the plugin file as above
2. Open Roblox Studio
3. Go to **Avatar** tab → **Plugins**
4. Click **Plugin Management**
5. Upload `Vector.rbxm`
6. Configure metadata and publish

## Contributing

When modifying the plugin:

1. **Follow the Code Style**: Use StyLua for formatting
2. **Test Thoroughly**: Test with different scenarios and Studio states
3. **Handle Errors**: Wrap operations in pcall and provide meaningful error messages
4. **Maintain Safety**: Always use ChangeHistoryService for undoable operations
5. **Update Documentation**: Keep this README current with changes

## File Structure Details

- **`main.server.lua`**: Core plugin logic, UI management, and orchestration
- **`net/http.lua`**: HTTP utilities for communicating with the backend
- **`tools/`**: Each file implements one AI capability with a consistent interface:
  ```lua
  return function(args)
      -- Validate inputs
      -- Execute operation safely
      -- Return { ok = boolean, result/error = any }
  end
  ```

The plugin is designed to be robust, safe, and maintainable while providing a smooth developer experience for AI-assisted Roblox development.
