# GitHub Copilot Instructions for Vector — Roblox Studio Copilot

This file provides guidance to GitHub Copilot when working on the Vector codebase. Vector is an AI-powered Roblox Studio copilot with a Next.js backend and LLM tool-calling orchestrator, following a Cline-style approval-first workflow.

## Project Overview

Vector is a Roblox Studio AI copilot consisting of:
- **Studio Plugin (Luau)**: Provides docked chat UI, previews diffs, applies edits with undo support via ChangeHistoryService
- **Next.js Backend (TypeScript)**: Handles API endpoints, LLM orchestration, tool schemas, providers, and data persistence
- **LLM Integration**: Supports multiple providers (OpenRouter, Gemini, AWS Bedrock, NVIDIA) with one-tool-per-message workflow

## Architecture

### Core Components

1. **Backend** (`vector/apps/web/`)
   - API routes in `app/api/`
   - Orchestrator logic in `lib/orchestrator/`
   - Tool schemas and handlers in `lib/tools/`
   - Context management in `lib/context/`
   - Asset catalog integration in `lib/catalog/`
   - Diff engine in `lib/diff/`
   - Data stores in `lib/store/`

2. **Plugin** (`vector/plugin/`)
   - Main entry: `src/main.server.lua`
   - Tool handlers: `src/tools/*.lua`
   - Network helpers: `src/net/`
   - UI components in main file

3. **Data Flow**
   - User input → Context gathering → LLM tool call → Proposal generation → User approval → Apply with undo → Audit

### Key Principles

1. **Safety First**: All writes wrapped in ChangeHistoryService for undo support
2. **Approval Required**: Every change requires explicit user approval before application
3. **One Tool Per Message**: LLM proposes one tool call at a time, waits for result
4. **Diff-First Editing**: Show preview before applying any script changes
5. **Validation**: Multiple layers (schema, hash-based conflict detection, bounds checking)

## Coding Standards

### TypeScript (Backend)

```typescript
// Use Zod for validation
import { z } from 'zod';
const schema = z.object({ ... });

// Use descriptive error messages
throw new Error('[moduleName] Specific error description');

// Handle async operations properly
try {
  const result = await operation();
  return { success: true, data: result };
} catch (error) {
  console.error('[context]', error);
  return { success: false, error: String(error) };
}

// Use TypeScript strict mode
// Prefer interfaces for public APIs, types for internal structures
interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
```

### Luau (Plugin)

```lua
-- Use pcall for all operations that might fail
local success, result = pcall(function()
  -- operation
end)

if not success then
  warn("[toolName] Error:", result)
  return { success = false, error = tostring(result) }
end

-- Use ChangeHistoryService for all mutations
local ChangeHistoryService = game:GetService("ChangeHistoryService")
ChangeHistoryService:SetWaypoint("Before Operation")
-- perform operation
ChangeHistoryService:SetWaypoint("After Operation")

-- Return structured results
return {
  success = true,
  path = "game.Workspace.Part",
  data = { ... }
}
```

## Tool Development

### Adding New Tools

1. **Backend Tool Schema** (`lib/tools/`)
   - Define Zod schema in appropriate file
   - Add to tool registry
   - Document parameters and return types
   - Include examples in comments

2. **Plugin Tool Handler** (`plugin/src/tools/`)
   - Create handler function
   - Wrap in pcall
   - Use ChangeHistoryService for mutations
   - Return structured results
   - Update `tools/README.md`

3. **Tool Categories**
   - **Context Tools**: Read-only (get_active_script, list_selection, list_open_documents)
   - **Edit Tools**: Modify scripts (show_diff, apply_edit)
   - **Object Tools**: Create/modify instances (create_instance, set_properties, rename_instance, delete_instance)
   - **Asset Tools**: Search/insert assets (search_assets, insert_asset, generate_asset_3d)
   - **Planning Tools**: Workflow management (start_plan, update_plan, complete, attempt_completion)

### Tool Call Format

All tools use XML-like format:
```xml
<tool_name>
  <param1>value1</param1>
  <param2>value2</param2>
</tool_name>
```

Complex parameters can use JSON:
```xml
<set_properties>
  <path>game.Workspace.Part</path>
  <props>{"Size": [10, 10, 10], "Anchored": true}</props>
</set_properties>
```

## System Prompt Guidelines

When modifying the system prompt (`lib/orchestrator/prompts/`):

1. **Keep it deterministic**: Clear, step-by-step instructions
2. **One tool per message**: Enforce strict tool discipline
3. **Planning first**: Complex tasks require `<start_plan>` before action
4. **Asset-first workflow**: Prefer `search_assets` → `insert_asset` over manual `create_instance`
5. **Completion requires code**: Geometry work must include Luau script (unless user opts out)
6. **Examples are guidance only**: Don't enforce specific content from examples

### Planner Expectations

For non-trivial tasks (8-15+ steps typical):
```xml
<start_plan>
  <steps>[
    "Tool action with exact target and intention",
    "Search assets query='...' tags=['model'] limit=6",
    "Insert asset <ID> under game.Workspace.Parent",
    "Set properties (Anchored, CFrame) for 'Name' at position",
    "Open or create Script 'Name' in ServerScriptService",
    "Show diff to add idempotent Luau that rebuilds structures"
  ]</steps>
</start_plan>
```

## API Routes

### Core Endpoints

- `POST /api/chat`: Main orchestrator endpoint
  - Accepts user message, context, provider override
  - Returns proposals array and task state
  - Handles streaming via event bus

- `GET /api/stream`: Long-poll for status updates
  - Used by Studio plugin
  - Returns events since last cursor

- `GET /api/stream/sse`: Server-sent events for web dashboard

- `POST /api/proposals/:id/apply`: Records approval and execution
  - Plugin calls after user approves
  - Creates audit entry

- `GET /api/assets/search`: Asset catalog search
  - Query, limit, tags parameters
  - Returns normalized asset list

- `POST /api/assets/generate3d`: Text-to-3D generation
  - Proxies to Meshy API
  - Returns job ID for polling

## Provider Integration

### Supported Providers

1. **OpenRouter**: Default, configurable model
2. **Gemini**: Direct Google API, type-checked responses
3. **AWS Bedrock**: Claude, Titan, Llama variants via InvokeModel
4. **NVIDIA**: NIM endpoints, OpenAI-compatible

### Environment Configuration

```bash
# OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_MODEL=moonshotai/kimi-k2:free
VECTOR_USE_OPENROUTER=0

# Gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

# AWS Bedrock
BEDROCK_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0

# NVIDIA
NVIDIA_API_KEY=
NVIDIA_MODEL=llama-3.1-70b-instruct

# Provider selection
VECTOR_DEFAULT_PROVIDER=openrouter
```

### Adding New Providers

1. Create adapter in `lib/orchestrator/providers/`
2. Implement `sendToolCall` method
3. Parse provider-specific response to standard format
4. Add configuration to `.env.example`
5. Update provider chooser logic
6. Test with various tool calls

## Safety and Validation

### Edit Validation

- **Hash checking**: Validate `beforeHash` matches current content
- **Bounds checking**: Edits ≤20 per proposal, ≤2000 chars total
- **Non-overlapping**: Sort and validate edits don't conflict
- **Multi-file**: Use diff3 merging with conflict detection

### Instance Operations

- **Path validation**: Check paths exist before operations
- **Selection inference**: Default to selected instance when path not provided
- **Parent validation**: Ensure parent exists before creating children
- **Auto-creation**: Under Workspace, auto-create missing Model parents

### Permission Flow

1. **HTTP Permission**: First network request prompts user
2. **Script Modification**: First edit prompts user
3. **Domain whitelist**: Only `http://127.0.0.1:3000` in dev

## Streaming and Events

### Event Types

- `orchestrator.start`: Workflow begins
- `tool.parsed`: Tool call extracted from LLM response
- `tool.valid`: Tool passed schema validation
- `tool.result`: Tool execution completed
- `proposals.mapped`: Proposals generated from tool
- `context.request`: Context tool executed
- `error.*`: Various error conditions

### Logging

```typescript
// Provider raw responses
console.log('[orch] provider.raw', { provider, content });

// Tool execution
console.log('[tool.execute]', { name, args });

// Proposal generation
console.log('[proposals]', { count, types });
```

## Testing Guidelines

### Backend Tests

- Use Vitest or Jest
- Mock LLM provider responses
- Test tool schema validation
- Test diff generation and merging
- Test proposal generation logic

### Plugin Testing

- Test in Roblox Studio
- Verify undo/redo works correctly
- Test with various instance types
- Verify permission prompts
- Test error handling and recovery

### Integration Testing

1. Start backend: `npm run dev`
2. Load plugin in Studio
3. Test simple commands first
4. Verify proposals render correctly
5. Test approval and apply flow
6. Verify undo functionality

## Common Patterns

### Caching Tool Results

```typescript
const fingerprint = generateFingerprint({ tool: 'get_active_script', args });
const cached = cache.get(fingerprint);
if (cached && !cached.isExpired()) {
  return cached.result;
}
```

### Error Handling

```typescript
// Backend
try {
  const result = await operation();
  return { success: true, data: result };
} catch (error) {
  console.error('[context]', error);
  return { success: false, error: String(error) };
}

// Plugin
local success, result = pcall(function()
  return performOperation()
end)
if not success then
  return { success = false, error = tostring(result) }
end
return { success = true, data = result }
```

### Proposal Generation

```typescript
const proposals: Proposal[] = [];

if (toolName === 'show_diff') {
  proposals.push({
    type: 'edit',
    scriptPath: args.path,
    edits: parseEdits(args),
    beforeHash: computeHash(currentContent)
  });
}

if (toolName === 'create_instance') {
  proposals.push({
    type: 'object',
    operation: 'create',
    className: args.className,
    parentPath: args.parentPath,
    props: args.props || {}
  });
}
```

## File Organization

### Backend Structure
```
vector/apps/web/
├── app/api/          # Next.js API routes
├── lib/
│   ├── orchestrator/ # LLM orchestration
│   ├── tools/        # Tool schemas
│   ├── context/      # Context management
│   ├── catalog/      # Asset integration
│   ├── diff/         # Diff engine
│   └── store/        # Data persistence
├── types/            # TypeScript types
└── .env.local        # Configuration
```

### Plugin Structure
```
vector/plugin/
├── src/
│   ├── main.server.lua  # Entry point, UI
│   ├── tools/           # Tool handlers
│   └── net/             # Network helpers
└── plugin.project.json  # Rojo config
```

## Documentation

When adding features:

1. Update `Vector.md` for design decisions
2. Update `IMPLEMENTATION_STATUS.md` for progress tracking
3. Update README files in relevant directories
4. Add inline comments for complex logic
5. Include examples in tool schemas

## Development Workflow

1. **Setup**
   ```bash
   cd vector/apps/web
   npm install
   npm run dev
   ```

2. **Plugin Development**
   ```bash
   cd vector/plugin
   rojo serve plugin.project.json
   # Open Studio, connect to Rojo
   ```

3. **Linting**
   ```bash
   npm run lint
   ```

4. **Building**
   ```bash
   npm run build
   ```

## Best Practices

### Do's ✓

- Always wrap mutations in ChangeHistoryService
- Validate all inputs with Zod schemas
- Use pcall in Luau for error handling
- Log provider responses for debugging
- Keep tool calls atomic and focused
- Document complex logic with comments
- Test undo/redo for all mutations
- Cache expensive context operations
- Use structured error messages

### Don'ts ✗

- Don't modify Script.Source directly (use ScriptEditorService)
- Don't skip hash validation on edits
- Don't allow multiple tools per LLM message
- Don't hard-code paths or configurations
- Don't skip permission checks
- Don't return unstructured errors
- Don't create unbounded tool executions
- Don't mix provider credentials
- Don't skip audit logging

## Debugging

### Backend Issues

```bash
# Check logs
npm run dev  # Watch console for [orch] messages

# Test API endpoints
curl http://127.0.0.1:3000/api/assets/search?query=test&limit=3

# Verify environment
cat .env.local
```

### Plugin Issues

- Check Studio Output window for errors
- Verify permissions granted (HTTP, Script Modification)
- Test with simple commands first
- Check network requests in developer console
- Verify backend is running on port 3000

### Common Issues

1. **"No proposals" responses**
   - Check backend console for errors
   - Verify provider credentials
   - Test with simple commands

2. **Edits not applying**
   - Verify hash matches
   - Check ChangeHistoryService recording
   - Verify Script Modification permission

3. **Assets not inserting**
   - Check asset ID validity
   - Verify catalog API configuration
   - Check InsertService permissions

## Contributing

When making changes:

1. Follow existing code style and patterns
2. Add tests for new functionality
3. Update documentation
4. Test in both dev and production-like environments
5. Verify undo/redo works correctly
6. Run linting before committing
7. Keep changes focused and minimal

## References

- Main spec: `Vector.md`
- Implementation status: `IMPLEMENTATION_STATUS.md`
- Backend README: `vector/apps/web/README.md`
- Plugin README: `vector/plugin/README.md`
- Tool registry: `vector/apps/web/lib/tools/`
- System prompts: `vector/apps/web/lib/orchestrator/prompts/`
