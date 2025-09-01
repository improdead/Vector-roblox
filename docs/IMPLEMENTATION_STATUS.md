# Vector Implementation Status (Spec)

This document summarizes what’s implemented, what’s partial/dummy, what’s not implemented, and what inputs/decisions are needed.

Scope: warp/apps/web (Next.js) and warp/plugin (Roblox Studio plugin).

Implemented

- Plugin (Luau)
  - Dock UI with chat input and proposal list
  - Context capture: active script (path + editor source) and selection
  - Send to backend: POST /api/chat with context and optional provider settings
  - Proposal rendering: edit/object_op/asset_op cards
  - Approve/Reject per proposal
  - Apply edit proposals (rangeEDITS) with ChangeHistoryService and ScriptEditorService:UpdateSourceAsync
  - Apply object_op rename_instance (ChangeHistoryService wrapped)
  - Diff preview: simple unified diff snippet (on-demand Open Diff)
  - Asset search UI: Browse button calling /api/assets/search and inline “Insert” using InsertService
  - “Apply & Open” for edit proposals
  - Apply result reporting: POST /api/proposals/:id/apply
  - Settings popup (internal testing): configure OpenRouter Base URL, API Key, and Model, with Kimi K2 preset and Test button

- Backend (Next.js, TypeScript)
  - Routes
    - POST /api/chat: validates input, runs orchestrator, returns proposals, persists for audit
    - GET /api/proposals: list stored proposals
    - POST /api/proposals/[id]/apply: mark proposal applied with event payload
    - GET /api/assets/search: calls external CATALOG_API_URL provider; returns normalized results
    - POST /api/assets/generate3d: returns stub jobId
  - Orchestrator
    - Provider: OpenRouter adapter; reads API key/model from per-request provider or env
    - Tool-call parsing: expects one XML-like tool call; zod-validated args; maps to proposals
    - Fallback behavior when provider parsing fails: safe edit/object/asset proposals
    - Plan/Act scaffold: if the first tool is a context tool and flags enabled, executes locally and performs one follow-up provider call
  - Persistence
    - File-backed JSON datastore for proposals and audit under warp/apps/web/data/proposals.json

Half-implemented (placeholder/dummy)

- Diff preview
  - Minimal unified diff preview (single simplified render; line-by-line with limited context). Full multi-hunk, highlighted, and large-file optimized renderer pending.
- Plan/Act execution loop
  - Single extra step only (context tool → one additional provider call). Full multi-turn loop with guardrails and retries pending.
- 3D generation route
  - /api/assets/generate3d returns a stub jobId; no GPU job enqueueing or Open Cloud upload yet.
- Provider error handling
  - Errors surfaced when provider is configured; basic bubbling to plugin UI is present, with minimal categorization.

Not implemented

- Full provider-driven execution loop
  - Multi-turn Plan/Act with robust validation, retries, and proper context tool chaining.
- Robust diff merging on server
  - Multi-edit merging, conflict resolution, and path→Instance resolution generalization.
- Real Catalog integration service
  - Current backend requires an external CATALOG_API_URL service. No built-in Roblox web API integration or thumbnails yet.
- Durable database
  - Migrate from file-backed JSON to SQLite/Prisma (or similar) with richer audit and filtering endpoints (e.g., filter by projectId).
- Packaging and deploy
  - Vercel deployment, domain allowlisting in Studio, production environment plumbing.
- Streaming/transport
  - SSE/long-polling for plugin status updates is not implemented.

What you need to provide / decide

- CATALOG_API_URL
  - A server endpoint that returns normalized results [{ id, name, creator, type, thumbnailUrl? }]; required for /api/assets/search.
- Provider credentials path
  - Choose either: enter credentials in the plugin Settings (recommended for dev) or set OPENROUTER_API_KEY (+ optional OPENROUTER_MODEL) in warp/apps/web/.env(.local) and set VECTOR_USE_OPENROUTER=1.
- Persistence and deploy
  - Decide on DB (e.g., SQLite/Prisma) and hosting target (e.g., Vercel) for moving beyond local-only.
- Roblox Open Cloud credentials (later)
  - Needed for 3D generation uploads and asset insertion flows.

File map (key references)

- Backend
  - /warp/apps/web/app/api/chat/route.ts
  - /warp/apps/web/app/api/proposals/route.ts
  - /warp/apps/web/app/api/proposals/[id]/apply/route.ts
  - /warp/apps/web/app/api/assets/search/route.ts
  - /warp/apps/web/app/api/assets/generate3d/route.ts
  - /warp/apps/web/lib/orchestrator/index.ts
  - /warp/apps/web/lib/orchestrator/providers/openrouter.ts
  - /warp/apps/web/lib/tools/schemas.ts
  - /warp/apps/web/lib/diff/rangeEdits.ts
  - /warp/apps/web/lib/store/proposals.ts
  - /warp/apps/web/lib/store/persist.ts

- Plugin
  - /warp/plugin/src/main.server.lua (dock UI, settings popup, proposals, apply flows)
  - /warp/plugin/src/net/http.lua (HTTP helper)

Notes

- Localhost default: http://127.0.0.1:3000
- Plugin stores provider credentials locally via plugin:SetSetting; not committed.
- .gitignore excludes env files and warp/apps/web/data/ (local datastore).

