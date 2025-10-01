# Vector — Implementation Status

See also: IMPLEMENTATION_PLAN.md for the detailed roadmap, contracts, and acceptance criteria.

This document tracks what’s implemented, partial (placeholder or limited), and not implemented across the Vector codebase, plus decisions/APIs needed from you.

## Overview

- Web backend: Next.js app in `vector/apps/web` (Node runtime, Zod validation, file-backed persistence for proposals).
- Orchestrator: Provider-agnostic tool-call parsing → proposals in `vector/apps/web/lib/orchestrator`.
- Plugin (Roblox Studio): Chat UI, diff previews, apply basic edits/rename, and asset insertion in `vector/plugin`. Provider credentials are no longer stored in the plugin; the backend reads them from `.env`.
- Docs: System prompt, tools, flows in `Vector.md` and `cline_openai.md`.
- Docs: Multi‑turn orchestration spec in `multi-orchistration.md`.

## Recent Updates

- Scene-building prompt refresh (November 2026):
  - Expanded prompt guidance now emphasizes `<start_plan>` usage, checking existing instances, and iteratively placing anchored parts. Added end-to-end house and farm examples to encourage geometry-first edits.
  - Geometry intent still flips the opt-out flag, but script tools are no longer hard-blocked; behaviour now relies on prompt guidance instead of runtime enforcement.
- Raw provider logging (November 2026):
  - Every LLM reply is printed via `[orch] provider.raw …` for easier debugging of malformed XML/JSON payloads.
- Tool result message role (Dec 2026):
  - Tool results are now echoed back into the provider conversation as `user` messages (instead of `system`). This fixes models ignoring prior context tool outputs (e.g., `list_children`) and prematurely claiming the workspace is empty.
  - Paths: `apps/web/lib/orchestrator/index.ts:1531, 1553`.
- Parser robustness (Dec 2026):
  - `coercePrimitive` unwraps ```json fenced blocks and escapes bare newlines inside JSON strings before parsing.
  - `parseToolXML` returns `{ name, args, prefixText, suffixText }`, enabling optional “text before tool” streaming in the UI.
  - Added a tiny `parseXmlObject` to accept XML‑ish `<props><Name>Foo</Name></props>` emitted by some models.
  - Env flags: `VECTOR_ALLOW_TEXT_BEFORE_TOOL=1`, `VECTOR_ENFORCE_TOOL_AT_END=1`.
- Auto‑create missing parents (Dec 2026):
  - When a tool requests `create_instance` under `Workspace.<Name>` and that parent path doesn’t exist in the scene snapshot, the orchestrator prepends one or more `create_instance(Model)` ops under `game.Workspace` to construct the missing chain, then appends the requested child op. This removes the need to manually select the parent.
  - Scope: limited to Workspace descendants; safe and deterministic.
  - Path: `apps/web/lib/orchestrator/index.ts` in the `create_instance` mapping.
- Plugin UI fixes (Dec 2026):
  - Tooltip helper hoisted; removed nil call on hover. Guarded `.Visible` toggles on completion cards to avoid rare nils in `renderProposals`.
- Default script policy tracking (October 2026):
  - System prompt outlines the policy explicitly and trims legacy examples so guidance is concise.
- Orchestrator tracks geometry/object ops vs Luau edits per workflow and respects user opt-outs. Attempts to finish after geometry-only work now surface `SCRIPT_REQUIRED` validation errors until matching Luau edits land, so the guard is actively enforced.
- Policy state is persisted in TaskState for consistent nudges across turns and to keep the guard effective over multi-turn workflows.
- Asset search integration (October 2026):
  - Backend now queries Roblox's public catalog directly (thumbnails included) when `CATALOG_API_URL` is unset or set to `roblox`, so local setups get real asset IDs without extra infra.
  - `CATALOG_DISABLE_SEARCH=1` can be used to force manual creation flows; otherwise `<search_assets>` proposals are allowed by default.
  - Plugin forwards model-provided tags to `/api/assets/search`, enabling category-aware lookups without bespoke proxy services.
- Provider selection hardening (July 2026):
  - Added a deterministic provider chooser so OpenRouter, Gemini, AWS Bedrock, and NVIDIA never mix credentials or model overrides, honoring `VECTOR_DEFAULT_PROVIDER` plus user overrides.
  - Added Bedrock adapter (InvokeModel JSON) and NVIDIA adapter (OpenAI-compatible / NIM) with normalized XML-ish single-tool parsing.
  - Gemini client enforces type-checked responses and fails fast on empty or safety-blocked completions, keeping the orchestrator from continuing with blank output.
  - Catalog search logging sanitizes queries, records provider (roblox vs proxy), and still nudges models to fall back to manual creation if catalog lookups fail.
  - `.env.example` and `.env.local` expanded with `BEDROCK_*` and `NVIDIA_*` variables.
- Checkpoints + conflict loop (July 2026):
  - Automatic per-user-message checkpoints now run after each applied proposal; manual Snapshot/Restore buttons in the plugin call the API, stream status updates, and refresh TaskState metadata.
  - Diff3-powered multi-file apply runs on the server, returning structured conflict hunks when merges fail; the plugin renders those hunks inside the diff viewer and blocks auto-apply.
  - The plugin progress panel consumes TaskState for run badges, checkpoint labels, live progress %, and token telemetry, keeping the UI in sync with streaming events.
- Model overrides + Gemini support (June 2026):
  - Plugin exposes a model selector chip (server default vs `gemini-2.5-flash`) and forwards overrides through chat, retry, auto-continue, and workflow follow-up calls.
  - Backend `POST /api/chat` and orchestrator `runLLM()` accept `modelOverride`, log the active model, and forward it to OpenRouter.
  - Auto mode now applies `insert_asset` proposals, logging success/error details instead of skipping them.
- Deterministic linting (June 2026):
  - Added `.eslintrc.json` in `vector/apps/web`, switched `npm run lint` to `eslint . --ext .ts,.tsx --max-warnings=0`, and wired `prebuild` to lint so builds fail on warnings/errors.
  - Installed `eslint` and `eslint-config-next` as dev dependencies; `npm run lint` now runs non-interactively.
- Atomic JSON persistence with journaling (June 2026):
  - `vector/apps/web/lib/store/persist.ts` writes through `writeJsonAtomic`, appends journal entries before each mutation, and replays unapplied operations on boot.
  - Proposal/workflow stores automatically recover from mid-write crashes; journal files retain the last 32 entries.
- TaskState snapshots + tool run tracking (June 2026):
  - `runLLM()` now records user/assistant/system history, tool runs (queued/running/succeeded/failed), and streaming state in `taskStates.json` via `taskState.ts`.
  - `/api/chat` responses include the latest `taskState`, enabling UIs to reflect progress without guessing.
- Context mentions & code discovery (June 2026):
  - User prompts can reference `@file`, `@folder`, `@url`, and `@problems`; the orchestrator attaches the contents, appends summaries to TaskState, and feeds them to the provider with automatic history compaction. Workspace root resolution now validates `VECTOR_WORKSPACE_ROOT` and logs the resolved root for clarity. File reads use safe limited reads with robust close semantics.
  - Added read-only tools `list_code_definition_names` and `search_files` so the provider can inspect project structure without mutating anything.
- Provider retry/backoff & streaming upgrades (June 2026):
  - `callOpenRouter` now retries failed requests with exponential backoff (`OPENROUTER_MAX_RETRIES`, `OPENROUTER_RETRY_DELAY_MS`, `OPENROUTER_RETRY_MAX_MS`) before surfacing a clear error.
  - Streaming now uses an event-driven queue for long-poll and exposes `/api/stream/sse` for Server-Sent Events (Cursor-style live updates).
- Context auto-request fallback (June 2026):
  - When tools require missing context (e.g., no active script for `apply_edit`), the orchestrator injects a `CONTEXT_REQUEST …` message and retries (up to 3 requests, deduplicated by reason), mirroring Cline/Cursor’s auto-ask behaviour. Progress is streamed via `context.request <reason>` lines.
- Implementation plan refresh (June 2026):
  - Replaced previous phased roadmap with a Today → Next → This Week checklist covering linting, atomic persistence, TaskState snapshots, auto-approval, checkpoints, diff upgrades, streaming, context, resilience, plugin UX, and read-only code tools.
- Composer UI refresh (June 2026):
  - Rebuilt composer to match the provided mockup: attachment chips row, “Write, @ for context, / for commands” placeholder, combined ∞/Agent pill with inline auto toggle, model dropdown chip, and a quick menu (Retry/Next) behind the image button.
  - Progress label hides until non-zero progress, quick menu closes automatically on send or when the viewport shrinks, and the send button keeps its styling during retries.
- Backend build verification (June 2026):
  - `npm install && npm run build` succeeds in `vector/apps/web`, confirming the new schema changes compile.
- Code quality fixes (September 2025):
  - `vector/plugin/src/main.server.lua` declares `CURRENT_MODE` at file scope and avoids duplicate local state.
  - `vector/plugin/src/main.server.lua` reads the `vector_backend_base_url` plugin setting before falling back to localhost.
  - `vector/plugin/src/main.server.lua` cleans up the `InsertService:LoadAsset()` container after parenting the inserted model.
  - `vector/plugin/src/tools/apply_edit.lua` falls back to `ScriptEditorService:SetEditorSource()` when `UpdateSourceAsync` is unavailable.
  - This document now reflects the above plugin orchestration changes.

- Added detailed logging across orchestrator and API routes (see Vector.md “Logging & Observability”).
- Relaxed chat input schema: `context.activeScript` is now optional (was required `object|null`). This avoids HTTP 400 when no script is open in Studio; the provider can request context via tools when needed.
- Studio plugin UI: status panel is hidden until the first planning/status line arrives (prevents an empty black block under the composer). Composer now auto-sizes vertically and reflows the layout.
  - Transcript unification (Sept 2025): single transcript shows assistant text bubbles and compact tool chips. Proposals render inline; in Auto mode they auto-apply and show as chips only.
  - Ask-mode streaming (Sept 2025): added `message(text, phase)` tool and stream lines (`assistant.start|update|final`). `final_message` remains as shorthand.
- Upgraded system prompt and argument encoding rules (Cline‑style). Strict XML with JSON‑encoded parameter bodies; guidance for context gathering and validation retries.
- Parser hardening: tolerant JSON‑like parsing for tool parameters (single quotes, unquoted keys, trailing commas, and accidental code fences). Fixes repeated `props: Expected object, received string` errors from some models.
- Tool schemas now accept `props` as an object OR stringified JSON (coerced) for `create_instance` and `set_properties`.
- Path resolver in plugin supports bracket segments like `game.Workspace["My.Part"]["Wall [A]"]`.
- System prompt expanded with: output framing (exactly one tool tag), paths & names guardrails, typed wrappers contract for Roblox values, mode hints (Ask/Agent/Auto), asset/3D caveats, copy‑ready examples, discovery tools (`list_children`, `get_properties`), search semantics, and general manual build quality guidance (structures/vehicles/props). Planner guidance + canonical examples (house, vehicle, farm script) now live in `apps/web/lib/orchestrator/prompts/examples.ts` and are concatenated to `SYSTEM_PROMPT` in code.
- Orchestrator selection defaults: when exactly one instance is selected, infer missing `path`/`parentPath` for common tools (`set_properties`, `rename_instance`, `delete_instance`, `create_instance`, `insert_asset`).
- Edit constraints enforced server‑side: sort + non‑overlap check, with caps (≤20 edits, ≤2000 inserted characters). Invalid edits trigger validation feedback.
- Delete guard: refusing `delete_instance` at `game`/service roots to prevent destructive mistakes.
- Added Auto mode in the Studio plugin. When enabled, Vector auto‑applies proposals (including asset inserts) and continues the loop with bounded steps, logging each action in the status panel and updating the progress badge.
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
    - Returns `{ proposals, taskState }` (history + tool runs + streaming metadata).
    - `vector/apps/web/lib/orchestrator/index.ts:1`
    - Supports mention attachments (`@file`, `@folder`, `@url`) with automatic TaskState compaction and provider-visible context blocks.
  - Deterministic templates for milestone verification
    - (Deprecated) Removed old grid/farming shortcuts so requests always run through planning + scripting flow.
    - Edit proposals include `safety.beforeHash` for conflict detection.
  - Multi-turn Plan/Act loop with context tools (`get_active_script`, `list_selection`, `list_open_documents`).
    - Executes context tools locally, feeds JSON results back to the provider, and continues until an action tool is emitted or max turns is reached.
    - Config: `VECTOR_MAX_TURNS` (default 4). Per‑request overrides via `mode`/`maxTurns` and `enableFallbacks`. Context tool result for `activeScript.text` is truncated to 40k chars for safety.
    - System prompt updated to include context tools and rules.
    - `vector/apps/web/lib/orchestrator/index.ts:1`
  - Validation retries and diagnostics
    - On zod validation failure, reflect the error back to the model and retry up to 2 times, then error out.
    - Unknown tool names are echoed back once as a validation error to allow self-correction.
  - Mandatory planning
    - First action must be `<start_plan>`; other tools are rejected until a plan exists.
    - `<update_plan>` mutates TaskState and emits `plan.start/plan.update` stream chunks for UI feedback.
  - Script tracking & completion gate
    - Maintains per-workflow `scriptSources` cache (persisted in TaskState) so Luau edits know the latest Source text.
    - `open_or_create_script` backs creation of empty Scripts and returns `{ path, text, created }`; subsequent edits use `show_diff`/`set_properties` against that baseline.
    - `<complete>` / `<final_message>` are rejected until a non-empty Luau Source edit has been proposed.
  - Emits structured status/error chunks via in-memory stream store. The stream store now cleans idle workflows periodically to prevent memory leaks.
    - Env: `VECTOR_DISABLE_FALLBACKS=1` to disable server-side fallbacks (errors surface to client).
    - `vector/apps/web/lib/orchestrator/index.ts:1`
  - Tool schemas (Zod): strict validation for all advertised tools.
    - `vector/apps/web/lib/tools/schemas.ts:1`
    - Includes read-only `list_code_definition_names` and `search_files` definitions.
    - Added context tools `list_children` and `get_properties` to schemas.
    - Added `open_or_create_script(path,parentPath?,name?)` schema.
    - Added planning tools `start_plan(steps[])` and `update_plan(...)` (mandatory before actions).
    - Added `final_message(text,confidence?)` (Ask-mode friendly). Orchestrator maps it to a completion and emits `assistant.final` stream lines for the plugin transcript.
    - Includes read-only code intelligence tools `list_code_definition_names` and `search_files`.
  - Provider adapter (OpenRouter-compatible, OpenAI Chat Completions).
    - `vector/apps/web/lib/orchestrator/providers/openrouter.ts:1`
  - Adds request timeout with abort (env `OPENROUTER_TIMEOUT_MS`, default 30000ms). Clear error when `OPENROUTER_API_KEY` is missing with guidance.
  - Range edits + unified diff utilities.
    - `vector/apps/web/lib/diff/rangeEdits.ts:1`
  - In-memory sessions (last tool result), file-backed proposals store.
    - `vector/apps/web/lib/store/sessions.ts:1`
    - `vector/apps/web/lib/store/proposals.ts:1`
    - `vector/apps/web/lib/store/persist.ts:1`

- API routes (Next.js)
  - `POST /api/chat`: validates input, calls orchestrator, persists proposals.
    - Accepts optional `workflowId`, `approvedStepId`, and `autoApply` (mirrors Auto toggle). Creates a workflow if missing and returns `{ workflowId, proposals, taskState, isComplete:false }`.
    - Supports per-request `mode` ('ask' | 'agent'), `maxTurns` (int), `enableFallbacks` (bool), and `modelOverride` (string).
    - `vector/apps/web/app/api/chat/route.ts:1`
  - `GET /api/proposals`: lists persisted proposals; `POST /api/proposals/:id/apply`: marks applied.
    - `vector/apps/web/app/api/proposals/route.ts:1`
    - `vector/apps/web/app/api/proposals/[id]/apply/route.ts:1`
    - Apply route updates corresponding workflow step to `completed` when present.
  - `GET /api/stream`: long-poll status chunks for a `workflowId` or `projectId`.
    - `vector/apps/web/app/api/stream/route.ts:1`
    - Event-driven wait using the shared stream bus (no tight polling loop).
  - `GET /api/stream/sse`: Server-Sent Events endpoint for the same stream (dashboards/CLI).
    - `vector/apps/web/app/api/stream/sse/route.ts:1`
  - `GET /api/assets/search`: hits Roblox catalog when `CATALOG_API_URL` unset, or proxies when configured.
    - `vector/apps/web/app/api/assets/search/route.ts:1`
    - `vector/apps/web/lib/catalog/search.ts:1`
      - Adds fetch timeout via AbortController (env `CATALOG_TIMEOUT_MS`, default 15000ms).
      - Supports `Authorization: Bearer <CATALOG_API_KEY>` header when `CATALOG_API_KEY` is set.
  - `POST /api/assets/generate3d`: proxies to Meshy (text→3D) and returns a job id.
    - `vector/apps/web/app/api/assets/generate3d/route.ts:1`
      - Validates `prompt` (400 on missing/empty).
      - Auth: `Authorization: Bearer <key>` header from the plugin or `MESHY_API_KEY` env.
      - Config: `MESHY_API_URL` (default `https://api.meshy.ai/openapi/v2/text-to-3d`), `MESHY_TIMEOUT_MS`.
  - `GET /api/proposals?projectId=...`: filtered listing of proposals.
    - `vector/apps/web/app/api/proposals/route.ts:1`
  - Workflows listing and fetch (for resume/recovery):
    - `vector/apps/web/app/api/workflows/route.ts:1`
    - `vector/apps/web/app/api/workflows/[id]/route.ts:1`

- Plugin (Roblox Studio)
  - Main dock UI: chat input, proposal cards, diff preview renderer, approval flow.
    - `vector/plugin/src/main.server.lua:1`
    - Backend base URL assumed `http://127.0.0.1:3000` for local dev. For deploys, configure the app’s env/hosting. The plugin no longer exposes a backend URL setting.
    - Chat bar includes Ask/Agent toggle and a per‑message model selector (overrides Settings model).
    - Streaming: single long-poll `/api/stream` poller per workflow showing progress lines in the UI.
    - Dispatcher: object ops executed via tool modules; each mutation wrapped in ChangeHistory for an undo step.
    - Edit safety: validates `safety.beforeHash` (sha1) before applying edits; blocks on mismatch with a re-preview hint.
    - Auto mode only auto-applies proposals tagged `meta.autoApproved === true`; others remain for manual approval, preventing risky unattended actions.
  - Network helpers (GET/POST JSON).
    - `vector/plugin/src/net/http.lua:1`
-- Tool modules (Luau)
    - Context: `get_active_script`, `list_selection` (implemented), `list_open_documents` (best‑effort; falls back to ActiveScript on legacy)
      - `vector/plugin/src/tools/get_active_script.lua:1`
      - `vector/plugin/src/tools/list_selection.lua:1`
      - `vector/plugin/src/tools/list_open_documents.lua:1`
  - Scene queries: `list_children`, `get_properties` now return data from an in-memory scene graph that mirrors applied/object proposals.
    - Backend tracks created/renamed/deleted instances and property updates per workflow (`vector/apps/web/lib/orchestrator/sceneGraph.ts:1`).
    - Context tools surface that projection to the model so it can inspect existing builds.
  - Studio plugin now captures a bounded snapshot of `Workspace` (path/class/Name + basic props) on each chat send and includes it in the request context so the scene graph starts from real geometry (`vector/plugin/src/main.server.lua`).
    - Editing/object ops: `apply_edit` (enhanced with ScriptEditorService fallbacks), `create_instance`, `set_properties`, `rename_instance`, `delete_instance` (ChangeHistory wrapped)
      - `vector/plugin/src/tools/apply_edit.lua:1`
      - `vector/plugin/src/tools/create_instance.lua:1`
      - `vector/plugin/src/tools/set_properties.lua:1`
      - `vector/plugin/src/tools/rename_instance.lua:1`
      - `vector/plugin/src/tools/delete_instance.lua:1`
    - Assets: `insert_asset` (implemented), `search_assets` (backend call), `generate_asset_3d` (placeholder enqueue)
      - `vector/plugin/src/tools/insert_asset.lua:1`
      - `vector/plugin/src/tools/search_assets.lua:1` (uses configurable backend base URL)
      - `vector/plugin/src/tools/generate_asset_3d.lua:1` (uses configurable backend base URL)

## Partially Implemented (placeholders or limited)

- list_open_documents (plugin)
  - Event-driven tracking via ScriptEditorService when available; still falls back to ActiveScript-only on legacy Studio builds.
  - `vector/plugin/src/tools/list_open_documents.lua:1`

- generate_asset_3d (backend + plugin)
  - Backend route enqueues a placeholder job and returns `jobId`. No GPU, no Open Cloud upload, no assetId return.
  - Plugin tool posts to backend and returns `jobId` only.
  - `vector/apps/web/app/api/assets/generate3d/route.ts:1`
  - `vector/plugin/src/tools/generate_asset_3d.lua:1`

- Asset Catalog integration
  - Direct Roblox catalog search with thumbnail lookups when `CATALOG_API_URL` is unset; proxy/caching still optional.
  - `vector/apps/web/lib/catalog/search.ts:1`
  - Insert is user‑driven: the plugin shows a search result list with per‑item “Insert” buttons; clicking triggers `InsertService:LoadAsset(assetId)` then reports `/api/proposals/:id/apply`.
  - The agent will prefer manual geometry unless prompted to use catalog (by design of the current prompt).

- Tool module integration (plugin)
  - Decision: Fully dispatch through `src/tools/*.lua`.
  - Unified dispatch routes object ops (create/set/rename/delete) and edits (apply_edit) through tool modules for consistent validation and one undo step.
  - `vector/plugin/src/main.server.lua:1`, `vector/plugin/src/tools/apply_edit.lua:1`

- Packaging/deploy
  - No Vercel project set up, no domain allowlisting workflow documented inside Studio. Local env only.

- Workflows (server)
  - File-backed workflows store (`workflows.json`) with steps and statuses; no DB/Prisma yet.
  - Steps are created per proposal; approval (apply) updates step to `completed`.
  - No recovery/resume UI yet; no planner-generated step plan.

## Not Implemented

- Advanced chat shortcuts
  - Quick menu covers Retry/Next, but there are still no dedicated buttons for one-click “Ask” prompts, context presets, or slash-command menus.

- Agent‑driven Studio selection
  - There is no tool to change Studio selection from the orchestrator. Selection is read‑only context captured by the plugin and used for sensible defaults.
  - If needed, we can add a new tool and proposal op (e.g., `set_selection(paths[])`) plus a minimal plugin handler to set `Selection` and optionally focus the camera. This is optional given the new auto‑create behavior.

- Conversation summarization & guardrails
  - Context auto-request and history trimming are in place, but full summarization, guardrail prompts, and cross-run memory limits remain TODO.

- Analysis/CI tools (backend jobs)
  - `analyze_luau`, `run_tests`, `snapshot_project` not implemented.

- Durable database
  - Proposals persisted to JSON under `vector/apps/web/data/`. No SQL/Prisma backing.
  - Workflows persisted to `vector/apps/web/data/workflows.json`.

- Web dashboard UI
  - No frontend UI to browse proposals/history beyond simple API JSON.

- Thumbnails proxying/caching for assets
  - Backend doesn’t proxy or cache images; plugin list view shows names only. (Unchanged)

## Needs From You

- Provider credentials/decisions
  - OpenRouter: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `VECTOR_USE_OPENROUTER`.
  - Gemini: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_API_BASE_URL`, `GEMINI_TIMEOUT_MS`.
  - AWS Bedrock: `BEDROCK_REGION`, `BEDROCK_MODEL_ID`, and either role-based AWS auth or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (+ `AWS_SESSION_TOKEN` optional).
  - NVIDIA: `NVIDIA_API_KEY`, `NVIDIA_MODEL`, optional `NVIDIA_API_BASE_URL`.
  - `VECTOR_DEFAULT_PROVIDER` selects default among `openrouter|gemini|bedrock|nvidia` when no override is supplied.
  - Decide default model(s) + fallback order.
  - Optional: `VECTOR_MAX_TURNS` (default 4); timeouts per provider (`OPENROUTER_TIMEOUT_MS`, `GEMINI_TIMEOUT_MS`).

- Catalog provider
  - Built-in Roblox catalog search now runs when `CATALOG_API_URL` is unset (or set to `roblox`); no proxy is required for local workflows.
  - Set `CATALOG_API_URL` to your own proxy if you need custom filtering/caching, and pass `CATALOG_API_KEY` for auth when applicable.
  - Use `CATALOG_DISABLE_SEARCH=1` to force manual scene creation instead of catalog lookups.

- 3D generation pipeline
  - Confirm Meshy configuration for production (API limits, status/polling endpoint, retries).
  - Roblox Open Cloud credentials and flow for uploading generated assets to obtain `assetId`.
  - Target output format (mesh type, poly limits, thumbnail handling).

- Streaming vs polling
  - Studio uses long-polling `/api/stream`; an SSE route (`/api/stream/sse`) exists for dashboards.

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
  - `cd vector/apps/web && npm install && npm run dev` (or `npm run build && npm start`).
  - Configure `.env.local` (already added):
    - `OPENROUTER_API_KEY` (optional; leave empty to use safe fallbacks),
    - `OPENROUTER_MODEL=moonshotai/kimi-k2:free`, `OPENROUTER_TIMEOUT_MS=30000`,
    - `VECTOR_USE_OPENROUTER=0` by default (set to `1` to enable provider),
    - `VECTOR_MAX_TURNS` (optional), `VECTOR_DISABLE_FALLBACKS` (optional),
    - `CATALOG_API_URL`/`CATALOG_API_KEY`/`CATALOG_TIMEOUT_MS` (optional),
  - `MESHY_API_KEY` (optional),
  - `GEMINI_API_KEY` / `GEMINI_MODEL` (optional),
  - `BEDROCK_REGION` / `BEDROCK_MODEL_ID` (optional; plus AWS creds or role),
  - `NVIDIA_API_KEY` / `NVIDIA_MODEL` (optional).
  - Data directory: proposals persisted at `vector/apps/web/data/proposals.json` (auto-created).
  - Data directory: workflows persisted at `vector/apps/web/data/workflows.json` (auto-created).
  - `.gitignore` excludes env files under `vector/apps/web` and the local `data/` folder.

// Studio Plugin
  - Load plugin and open the Vector dock. No settings are required; the backend uses `.env.local`.
  - First HTTP request prompts domain permission; first write prompts Script Modification permission.
  - New UI actions: “Retry” re-runs the last prompt as a new workflow; “Next” continues the same workflow with one more small step. A top “Status” panel shows streaming progress like a sidebar.

## Recommended Next Steps

- Refine streaming UI indicators; add retention policy and filters for `/api/stream`.
- Expand orchestrator to full multi-turn Plan/Act with retries and guardrails; wire new context tools (`list_children`, `get_properties`).
- Improve server diff merging for multi-edit proposals; consider hashing and conflict detection.
- Design and implement `run_scene_patch` (ModuleScript patch runner) once sandboxing + timeouts are specified; currently deferred.
- Replace file-backed JSON with SQLite/Prisma for proposals/audit; add filtering endpoints (by `projectId`).
- Optional catalog proxy/cache for production (rate limiting, thumbnails, moderation filters).
- 3D pipeline: add job status polling endpoint, map Meshy states, and upload via Open Cloud to obtain `assetId`.
- Package for Vercel and document Studio domain allowlisting.

## Notes

- `cline_openai.md` contains a concise Vector system prompt; will evolve with the tool registry and execution loop.

## Known Limitations

- Diff rendering in plugin is simplified for very large files; server-side diff is basic.
- Multi-edit merge conflicts aren’t robust yet.
- Asset thumbnails not shown; backend doesn’t proxy/cache images.
- No SSE/WebSocket due to Studio constraints; streaming not yet emulated via long-polling route.
