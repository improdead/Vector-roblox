# Vector/Warp — Implementation Status

This document tracks what’s implemented, partial (placeholder or limited), and not implemented across the Vector/Warp codebase, plus decisions/APIs needed from you.

## Overview

- Web backend: Next.js app in `warp/apps/web` (Node runtime, Zod validation, file-backed persistence for proposals).
- Orchestrator: Provider-agnostic tool-call parsing → proposals in `warp/apps/web/lib/orchestrator`.
- Plugin (Roblox Studio): Chat UI, diff previews, apply basic edits/rename, and asset insertion in `warp/plugin`.
- Docs: System prompt, tools, flows in `Warp.md` and `cline_openai.md`.

## Implemented

- Orchestrator core
  - `runLLM()` maps tool-calls to proposals; adds fallback behaviors.
    - `warp/apps/web/lib/orchestrator/index.ts:1`
  - Tool schemas (Zod): strict validation for all advertised tools.
    - `warp/apps/web/lib/tools/schemas.ts:1`
  - Provider adapter (OpenRouter-compatible, OpenAI Chat Completions).
    - `warp/apps/web/lib/orchestrator/providers/openrouter.ts:1`
  - Range edits + unified diff utilities.
    - `warp/apps/web/lib/diff/rangeEdits.ts:1`
  - In-memory sessions (last tool result), file-backed proposals store.
    - `warp/apps/web/lib/store/sessions.ts:1`
    - `warp/apps/web/lib/store/proposals.ts:1`
    - `warp/apps/web/lib/store/persist.ts:1`

- API routes (Next.js)
  - `POST /api/chat`: validates input, calls orchestrator, persists proposals.
    - `warp/apps/web/app/api/chat/route.ts:1`
  - `GET /api/proposals`: lists persisted proposals; `POST /api/proposals/:id/apply`: marks applied.
    - `warp/apps/web/app/api/proposals/route.ts:1`
    - `warp/apps/web/app/api/proposals/[id]/apply/route.ts:1`
  - `GET /api/assets/search`: calls catalog provider with stub fallback if `CATALOG_API_URL` unset.
    - `warp/apps/web/app/api/assets/search/route.ts:1`
    - `warp/apps/web/lib/catalog/search.ts:1`
  - `POST /api/assets/generate3d`: enqueues a placeholder GPU job (returns `jobId`).
    - `warp/apps/web/app/api/assets/generate3d/route.ts:1`

- Plugin (Roblox Studio)
  - Main dock UI: chat input, proposal cards, diff preview renderer, approval flow.
    - `warp/plugin/src/main.server.lua:1`
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
      - `warp/plugin/src/tools/search_assets.lua:1`
      - `warp/plugin/src/tools/generate_asset_3d.lua:1`

## Partially Implemented (placeholders or limited)

- Plan/Act execution loop (orchestrator)
  - Only a single “context tool → follow-up” call is scaffolded via `VECTOR_PLAN_ACT=1`.
  - Multi-turn tool orchestration, retries, and guardrails not yet implemented.
  - `warp/apps/web/lib/orchestrator/index.ts:200`

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
  - Tools are implemented as separate files but `main.server.lua` currently uses inline functions for proposals. A unified tool-dispatch layer is not wired yet.
  - `warp/plugin/src/main.server.lua:1`

- Packaging/deploy
  - No Vercel project set up, no domain allowlisting workflow documented inside Studio. Local env only.

## Not Implemented

- Streaming endpoints for Studio
  - No `/api/stream` long-polling or chunk streaming route implemented. Plugin performs one-shot `/api/chat`.

- Advanced diff merging on server
  - Server merges range edits only for previews; no generalized multi-edit conflict resolution beyond simple application.

- Full provider-driven, multi-turn tool loop
  - Missing retries, backoff, context compaction with summarization, and safety guardrails.
  - `warp/apps/web/lib/orchestrator/context.ts` has placeholder token accounting.

- Analysis/CI tools (backend jobs)
  - `analyze_luau`, `run_tests`, `snapshot_project` not implemented.

- Durable database
  - Proposals persisted to JSON under `warp/apps/web/data/`. No SQL/Prisma backing.

- Web dashboard UI
  - No frontend UI to browse proposals/history beyond simple API JSON.

- Thumbnails proxying/caching for assets
  - Backend doesn’t proxy or cache images; plugin list view shows names only.

## Needs From You

- Provider credentials/decisions
  - OpenRouter-compatible provider: Base URL, API Key, Model ID. Either pass via plugin Settings (preferred) or `.env.local`:
    - `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (optional), `VECTOR_USE_OPENROUTER=1` to enable provider path.
  - Decide default model(s) and whether to enable `VECTOR_PLAN_ACT=1`.

- Catalog provider
  - Provide `CATALOG_API_URL` that returns normalized `{ results: [{ id, name, creator, type, thumbnailUrl? }] }`.
  - Or confirm usage of stubbed results during local development.

- 3D generation pipeline
  - GPU service/API details for text→3D generation.
  - Roblox Open Cloud credentials and flow for uploading resulting assets to obtain `assetId`.
  - Target output format (mesh type, poly limits, thumbnail handling).

- Streaming vs polling
  - Choose transport for Studio (recommend long-polling `/api/stream`). If approved, I’ll implement backend route + plugin polling loop.

- Persistence strategy
  - Confirm if we should move from JSON file to SQLite/Prisma, and any hosting constraints (e.g., Vercel Postgres).

- Tool invocation in plugin
  - Confirm whether to refactor `main.server.lua` to dispatch through `src/tools/*.lua` modules for consistency.

- Packaging/deploy
  - Confirm target hosting (Vercel or other), environment variables, and Studio domain allowlist.

- UI priorities
  - Decide on timeline for richer diff UI (line-by-line), streaming indicators, and asset thumbnails.

## Quick Run Notes

- Web
  - `cd warp/apps/web && npm install && npm run dev` (or `npm run build && npm start`).
  - Optional `.env.local`: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `VECTOR_USE_OPENROUTER=1`, `VECTOR_PLAN_ACT=0|1`, `CATALOG_API_URL`.
  - Data directory: proposals persisted at `warp/apps/web/data/proposals.json` (auto-created).
  - `.gitignore` excludes env files under `warp/apps/web` and the local `data/` folder.

- Studio Plugin
  - Load plugin, open the Vector dock. Use “Vector Settings” to enter provider config.
  - First HTTP request prompts domain permission; first write prompts Script Modification permission.

## Recommended Next Steps

- Implement `/api/stream` and plugin long-poll loop; add streaming UI indicators.
- Expand orchestrator to full multi-turn Plan/Act with retries and guardrails; wire new context tools (`list_children`, `get_properties`).
- Improve server diff merging for multi-edit proposals; consider hashing and conflict detection.
- Replace file-backed JSON with SQLite/Prisma for proposals/audit; add filtering endpoints (by `projectId`).
- Real Catalog integration and asset thumbnail rendering; optional proxy/cache layer.
- GPU 3D pipeline: integrate service, upload via Open Cloud, return `assetId` in `generate_asset_3d`.
- Package for Vercel and document Studio domain allowlisting.

## Notes

- `cline_openai.md` contains a concise Vector system prompt; will evolve with the tool registry and execution loop.

## Known Limitations

- Diff rendering in plugin is simplified for very large files; server-side diff is basic.
- Multi-edit merge conflicts aren’t robust yet.
- Asset thumbnails not shown; backend doesn’t proxy/cache images.
- No SSE/WebSocket due to Studio constraints; streaming not yet emulated via long-polling route.
