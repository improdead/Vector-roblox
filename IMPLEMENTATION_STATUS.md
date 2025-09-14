# Vector/Warp — Implementation Status

This document tracks what’s implemented, partial (placeholder or limited), and not implemented across the Vector/Warp codebase, plus decisions/APIs needed from you.

## Overview

- Web backend: Next.js app in `warp/apps/web` (Node runtime, Zod validation, file-backed persistence for proposals).
- Orchestrator: Provider-agnostic tool-call parsing → proposals in `warp/apps/web/lib/orchestrator`.
- Plugin (Roblox Studio): Chat UI, diff previews, apply basic edits/rename, and asset insertion in `warp/plugin`. Provider credentials are no longer stored in the plugin; the backend reads them from `.env`.
- Docs: System prompt, tools, flows in `Warp.md` and `cline_openai.md`.
- Docs: Multi‑turn orchestration spec in `multi-orchistration.md`.

## Recent Updates

- Added detailed logging across orchestrator and API routes (see Warp.md “Logging & Observability”).
- Relaxed chat input schema: `context.activeScript` is now optional (was required `object|null`). This avoids HTTP 400 when no script is open in Studio; the provider can request context via tools when needed.
- Studio plugin UI: status panel is hidden until the first planning/status line arrives (prevents an empty black block under the composer). Composer now auto-sizes vertically and reflows the layout.
- Upgraded system prompt and argument encoding rules (Cline‑style). Strict XML with JSON‑encoded parameter bodies; guidance for context gathering and validation retries.
- Parser hardening: tolerant JSON‑like parsing for tool parameters (single quotes, unquoted keys, trailing commas, and accidental code fences). Fixes repeated `props: Expected object, received string` errors from some models.
- Tool schemas now accept `props` as an object OR stringified JSON (coerced) for `create_instance` and `set_properties`.
- Path resolver in plugin supports bracket segments like `game.Workspace["My.Part"]["Wall [A]"]`.
- System prompt expanded with: output framing (exactly one tool tag), paths & names guardrails, typed wrappers contract for Roblox values, mode hints (Ask/Agent/Auto), asset/3D caveats, and copy‑ready examples.
- Orchestrator selection defaults: when exactly one instance is selected, infer missing `path`/`parentPath` for common tools (`set_properties`, `rename_instance`, `delete_instance`, `create_instance`, `insert_asset`).
- Edit constraints enforced server‑side: sort + non‑overlap check, with caps (≤20 edits, ≤2000 inserted characters). Invalid edits trigger validation feedback.
- Delete guard: refusing `delete_instance` at `game`/service roots to prevent destructive mistakes.
- Added Auto mode in the Studio plugin (toggle chip). When enabled, Vector auto‑applies proposals and continues the loop with bounded steps, logging each action in the status panel. UI design unchanged (reuses chip styling) and step logs appear right after user input.
- Input UX: Added Enter-to-Send in the plugin composer. Press Enter to send; Shift+Enter inserts a newline.
- Backend `/api/assets/generate3d` now proxies to Meshy; configurable via env.
- Plugin Settings panel removed. Provider configuration is sourced from backend `.env` instead of Studio settings.
- Hardened tools:
  - `apply_edit.lua` supports path/instance, beforeHash conflict detection, and range-edit fallback.
  - `get_properties.lua` returns typed JSON-safe values and supports attributes.
  - `list_children.lua` adds depth/maxNodes caps and optional class filtering.

## Implemented

- Orchestrator core
  - `runLLM()` maps tool-calls to proposals; adds fallback behaviors.
    - `warp/apps/web/lib/orchestrator/index.ts:1`
  - Deterministic templates for milestone verification
    - Recognizes “grid 3x3” and “farming” and returns sequential object-op proposals without provider.
    - Edit proposals include `safety.beforeHash` for conflict detection.
  - Multi-turn Plan/Act loop with context tools (`get_active_script`, `list_selection`, `list_open_documents`).
    - Executes context tools locally, feeds JSON results back to the provider, and continues until an action tool is emitted or max turns is reached.
    - Config: `VECTOR_MAX_TURNS` (default 4). Per‑request overrides via `mode`/`maxTurns` and `enableFallbacks`. Context tool result for `activeScript.text` is truncated to 40k chars for safety.
    - System prompt updated to include context tools and rules.
    - `warp/apps/web/lib/orchestrator/index.ts:1`
  - Validation retries and diagnostics
    - On zod validation failure, reflect the error back to the model and retry up to 2 times, then error out.
    - Unknown tool names are echoed back once as a validation error to allow self-correction.
    - Emits structured status/error chunks via in-memory stream store.
    - Env: `VECTOR_DISABLE_FALLBACKS=1` to disable server-side fallbacks (errors surface to client).
    - `warp/apps/web/lib/orchestrator/index.ts:1`
  - Tool schemas (Zod): strict validation for all advertised tools.
    - `warp/apps/web/lib/tools/schemas.ts:1`
  - Provider adapter (OpenRouter-compatible, OpenAI Chat Completions).
    - `warp/apps/web/lib/orchestrator/providers/openrouter.ts:1`
    - Adds request timeout with abort (env `OPENROUTER_TIMEOUT_MS`, default 30000ms).
  - Range edits + unified diff utilities.
    - `warp/apps/web/lib/diff/rangeEdits.ts:1`
  - In-memory sessions (last tool result), file-backed proposals store.
    - `warp/apps/web/lib/store/sessions.ts:1`
    - `warp/apps/web/lib/store/proposals.ts:1`
    - `warp/apps/web/lib/store/persist.ts:1`

- API routes (Next.js)
  - `POST /api/chat`: validates input, calls orchestrator, persists proposals.
    - Accepts optional `workflowId`, `approvedStepId`. Creates a workflow if missing and returns `{ workflowId, proposals, isComplete:false }`.
    - Also accepts `mode` ('ask' | 'agent'), `maxTurns` (int), and `enableFallbacks` (bool) to control per‑request orchestration.
    - `warp/apps/web/app/api/chat/route.ts:1`
  - `GET /api/proposals`: lists persisted proposals; `POST /api/proposals/:id/apply`: marks applied.
    - `warp/apps/web/app/api/proposals/route.ts:1`
    - `warp/apps/web/app/api/proposals/[id]/apply/route.ts:1`
    - Apply route updates corresponding workflow step to `completed` when present.
  - `GET /api/stream`: long-poll status chunks for a `workflowId` or `projectId`.
    - `warp/apps/web/app/api/stream/route.ts:1`
  - `GET /api/assets/search`: calls catalog provider with stub fallback if `CATALOG_API_URL` unset.
    - `warp/apps/web/app/api/assets/search/route.ts:1`
    - `warp/apps/web/lib/catalog/search.ts:1`
      - Adds fetch timeout via AbortController (env `CATALOG_TIMEOUT_MS`, default 15000ms).
      - Supports `Authorization: Bearer <CATALOG_API_KEY>` header when `CATALOG_API_KEY` is set.
  - `POST /api/assets/generate3d`: proxies to Meshy (text→3D) and returns a job id.
    - `warp/apps/web/app/api/assets/generate3d/route.ts:1`
      - Validates `prompt` (400 on missing/empty).
      - Auth: `Authorization: Bearer <key>` header from the plugin or `MESHY_API_KEY` env.
      - Config: `MESHY_API_URL` (default `https://api.meshy.ai/openapi/v2/text-to-3d`), `MESHY_TIMEOUT_MS`.
  - `GET /api/proposals?projectId=...`: filtered listing of proposals.
    - `warp/apps/web/app/api/proposals/route.ts:1`
  - Workflows listing and fetch (for resume/recovery):
    - `warp/apps/web/app/api/workflows/route.ts:1`
    - `warp/apps/web/app/api/workflows/[id]/route.ts:1`

- Plugin (Roblox Studio)
  - Main dock UI: chat input, proposal cards, diff preview renderer, approval flow.
    - `warp/plugin/src/main.server.lua:1`
    - Backend base URL assumed `http://127.0.0.1:3000` for local dev. For deploys, configure the app’s env/hosting. The plugin no longer exposes a backend URL setting.
    - Chat bar includes Ask/Agent toggle and a per‑message model selector (overrides Settings model).
    - Streaming: single long-poll `/api/stream` poller per workflow showing progress lines in the UI.
    - Dispatcher: object ops executed via tool modules; each mutation wrapped in ChangeHistory for an undo step.
    - Edit safety: validates `safety.beforeHash` (sha1) before applying edits; blocks on mismatch with a re-preview hint.
  - Network helpers (GET/POST JSON).
    - `warp/plugin/src/net/http.lua:1`
  - Tool modules (Luau)
    - Context: `get_active_script`, `list_selection` (implemented), `list_open_documents` (placeholder)
      - `warp/plugin/src/tools/get_active_script.lua:1`
      - `warp/plugin/src/tools/list_selection.lua:1`
      - `warp/plugin/src/tools/list_open_documents.lua:1`
    - Scene queries: `list_children`, `get_properties` (implemented)
      - `warp/plugin/src/tools/list_children.lua:1`
      - `warp/plugin/src/tools/get_properties.lua:1`
    - Editing/object ops: `apply_edit` (minimal), `create_instance`, `set_properties`, `rename_instance`, `delete_instance` (ChangeHistory wrapped)
      - `warp/plugin/src/tools/apply_edit.lua:1`
      - `warp/plugin/src/tools/create_instance.lua:1`
      - `warp/plugin/src/tools/set_properties.lua:1`
      - `warp/plugin/src/tools/rename_instance.lua:1`
      - `warp/plugin/src/tools/delete_instance.lua:1`
    - Assets: `insert_asset` (implemented), `search_assets` (backend call), `generate_asset_3d` (placeholder enqueue)
      - `warp/plugin/src/tools/insert_asset.lua:1`
      - `warp/plugin/src/tools/search_assets.lua:1` (uses configurable backend base URL)
      - `warp/plugin/src/tools/generate_asset_3d.lua:1` (uses configurable backend base URL)

## Partially Implemented (placeholders or limited)

- list_open_documents (plugin)
  - Placeholder returns only ActiveScript; Roblox APIs don’t expose full tab enumeration in a simple way.
  - `warp/plugin/src/tools/list_open_documents.lua:1`

- apply_edit (plugin tool)
  - Minimal handler expects server to pre-merge text edits (`edits.__finalText`) rather than performing range application client-side.
  - Production path should merge edits into final source before `UpdateSourceAsync` or port the server’s range edit logic.
  - `warp/plugin/src/tools/apply_edit.lua:1`

- generate_asset_3d (backend + plugin)
  - Backend route enqueues a placeholder job and returns `jobId`. No GPU, no Open Cloud upload, no assetId return.
  - Plugin tool posts to backend and returns `jobId` only.
  - `warp/apps/web/app/api/assets/generate3d/route.ts:1`
  - `warp/plugin/src/tools/generate_asset_3d.lua:1`

- Asset Catalog integration
  - Uses stubbed results if `CATALOG_API_URL` is unset. No thumbnails proxying.
  - `warp/apps/web/lib/catalog/search.ts:1`

- Tool module integration (plugin)
  - Decision: Fully dispatch through `src/tools/*.lua`.
  - Unified dispatch routes object ops (create/set/rename/delete) and edits (apply_edit) through tool modules for consistent validation and one undo step.
  - `warp/plugin/src/main.server.lua:1`, `warp/plugin/src/tools/apply_edit.lua:1`

- Packaging/deploy
  - No Vercel project set up, no domain allowlisting workflow documented inside Studio. Local env only.

- Workflows (server)
  - File-backed workflows store (`workflows.json`) with steps and statuses; no DB/Prisma yet.
  - Steps are created per proposal; approval (apply) updates step to `completed`.
  - No recovery/resume UI yet; no planner-generated step plan.

## Not Implemented

- UI Retry/Ask shortcuts
  - Resume via `workflowId` is possible; explicit Retry/Ask buttons in the plugin UI are not added yet.

- Advanced diff merging on server
  - Server merges range edits only for previews; no generalized multi-edit conflict resolution beyond simple application.

- Full provider-driven, multi-turn tool loop
  - Core loop implemented with context tools and validation retries; still missing backoff, summarization, and advanced guardrails.
  - `warp/apps/web/lib/orchestrator/context.ts` has placeholder token accounting.

- Analysis/CI tools (backend jobs)
  - `analyze_luau`, `run_tests`, `snapshot_project` not implemented.

- Durable database
  - Proposals persisted to JSON under `warp/apps/web/data/`. No SQL/Prisma backing.
  - Workflows persisted to `warp/apps/web/data/workflows.json`.

- Web dashboard UI
  - No frontend UI to browse proposals/history beyond simple API JSON.

- Thumbnails proxying/caching for assets
  - Backend doesn’t proxy or cache images; plugin list view shows names only.

## Needs From You

- Provider credentials/decisions
  - OpenRouter-compatible provider (backend `.env.local`):
    - `OPENROUTER_API_KEY` (required to enable provider path),
    - `OPENROUTER_MODEL` (optional),
    - `VECTOR_USE_OPENROUTER=1` to force provider usage even if the plugin omits credentials.
  - Decide default model(s).
  - Optional: set `VECTOR_MAX_TURNS` (default 4) to control multi-turn depth.
  - Optional: set `OPENROUTER_TIMEOUT_MS` (default 30000) to cap provider calls.

- Catalog provider
  - Provide `CATALOG_API_URL` that returns normalized `{ results: [{ id, name, creator, type, thumbnailUrl? }] }`.
  - Optional `CATALOG_API_KEY` used as `Authorization: Bearer <key>` header.
  - Or confirm usage of stubbed results during local development.

- 3D generation pipeline
  - Confirm Meshy configuration for production (API limits, status/polling endpoint, retries).
  - Roblox Open Cloud credentials and flow for uploading generated assets to obtain `assetId`.
  - Target output format (mesh type, poly limits, thumbnail handling).

- Streaming vs polling
  - Choose transport for Studio (recommend long-polling `/api/stream`). If approved, I’ll implement backend route + plugin polling loop.

- Persistence strategy
  - Confirm if we should move from JSON file to SQLite/Prisma, and any hosting constraints (e.g., Vercel Postgres).

- Tool invocation in plugin
  - Confirm whether to refactor `main.server.lua` to dispatch through `src/tools/*.lua` modules for consistency.

- Packaging/deploy
  - Confirm target hosting (Vercel or other), environment variables, and Studio domain allowlist.
  - Plugin now assumes backend at `http://127.0.0.1:3000` for local development; set backend URL at deploy time in app code or env.

- UI priorities
  - Decide on timeline for richer diff UI (line-by-line), streaming indicators, and asset thumbnails.

## Quick Run Notes

// Web
  - `cd warp/apps/web && npm install && npm run dev` (or `npm run build && npm start`).
  - Configure `.env.local` (already added):
    - `OPENROUTER_API_KEY` (optional; leave empty to use safe fallbacks),
    - `OPENROUTER_MODEL=moonshotai/kimi-k2:free`, `OPENROUTER_TIMEOUT_MS=30000`,
    - `VECTOR_USE_OPENROUTER=0` by default (set to `1` to enable provider),
    - `VECTOR_MAX_TURNS` (optional), `VECTOR_DISABLE_FALLBACKS` (optional),
    - `CATALOG_API_URL`/`CATALOG_API_KEY`/`CATALOG_TIMEOUT_MS` (optional),
    - `MESHY_API_KEY` (optional).
  - Data directory: proposals persisted at `warp/apps/web/data/proposals.json` (auto-created).
  - Data directory: workflows persisted at `warp/apps/web/data/workflows.json` (auto-created).
  - `.gitignore` excludes env files under `warp/apps/web` and the local `data/` folder.

// Studio Plugin
  - Load plugin and open the Vector dock. No settings are required; the backend uses `.env.local`.
  - First HTTP request prompts domain permission; first write prompts Script Modification permission.
  - New UI actions: “Retry” re-runs the last prompt as a new workflow; “Next” continues the same workflow with one more small step. A top “Status” panel shows streaming progress like a sidebar.

## Recommended Next Steps

- Refine streaming UI indicators; add retention policy and filters for `/api/stream`.
- Expand orchestrator to full multi-turn Plan/Act with retries and guardrails; wire new context tools (`list_children`, `get_properties`).
- Improve server diff merging for multi-edit proposals; consider hashing and conflict detection.
- Replace file-backed JSON with SQLite/Prisma for proposals/audit; add filtering endpoints (by `projectId`).
- Real Catalog integration and asset thumbnail rendering; optional proxy/cache layer.
- 3D pipeline: add job status polling endpoint, map Meshy states, and upload via Open Cloud to obtain `assetId`.
- Package for Vercel and document Studio domain allowlisting.

## Notes

- `cline_openai.md` contains a concise Vector system prompt; will evolve with the tool registry and execution loop.

## Known Limitations

- Diff rendering in plugin is simplified for very large files; server-side diff is basic.
- Multi-edit merge conflicts aren’t robust yet.
- Asset thumbnails not shown; backend doesn’t proxy/cache images.
- No SSE/WebSocket due to Studio constraints; streaming not yet emulated via long-polling route.
