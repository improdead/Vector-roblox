# Multi‑Orchestration — Plan/Act Loop

This document specifies the multi‑turn orchestration flow used by Vector to drive tool calls, gather local context, and produce user‑approved proposals for Roblox Studio.

## Goals

- Single, unified Plan/Act loop that:
  - Lets the model request read‑only context via tools.
  - Executes context tools locally and feeds results back.
  - Continues until the model emits an actionable tool call that maps to proposals.
  - Applies strict validation and guardrails (turn limits, size limits).

## Current Implementation

- Location: `warp/apps/web/lib/orchestrator/index.ts`
- Entry: `runLLM(input)`
- Provider: OpenRouter‑compatible Chat Completions via `providers/openrouter.ts`
- System prompt lists both context and action tools and enforces “one tool per message”.

Note: `context.activeScript` is optional. When Studio has no open script, the provider can call `get_active_script` (or proceed with other tools) to gather context. The backend accepts missing `activeScript` and will not return 400.

### Loop

- Initialize messages with the user prompt.
- For up to `VECTOR_MAX_TURNS` (default 4):
  1. Call provider with `SYSTEM_PROMPT` + current `messages`.
  2. Parse an XML‑style tool call from assistant content.
  3. Validate args (Zod) when the tool is known.
  4. If tool is a context tool (`get_active_script`, `list_selection`, `list_open_documents`):
     - Execute locally from `input.context`.
     - Truncate `activeScript.text` to 40k chars when echoing back.
     - Append two messages:
       - assistant: exact tool call XML
       - user: `TOOL_RESULT <name>\n<json>`
     - Continue loop.
  5. Otherwise, map tool → proposals and return.
  6. If assistant emits `<plan>` (non‑action), record it and continue.
- If no valid action tool is produced within limits, fall back to safe proposals (comment edit, rename, or asset search).

### Validation & Mapping

- Tool schemas in `warp/apps/web/lib/tools/schemas.ts` (Zod) validate inputs strictly.
- Mapping produces one of:
  - `edit` proposals (rangeEDITS)
  - `object_op` proposals (instance operations)
  - `asset_op` proposals (search/insert/generate3d)

### Session Memory

- `setLastTool(projectId, name, result)` records the most recent tool/result pair.
- Token accounting and summarization hooks are scaffolded in `orchestrator/context.ts` (placeholder).

## Safety & Guardrails

- Turn cap: `VECTOR_MAX_TURNS` (default 4)
- Provider opt‑in: enable via request `provider` or env `VECTOR_USE_OPENROUTER=1`.
- Context truncation: `activeScript.text` truncated to 40k chars when echoed.
- Zod validation before mapping; unknown tools fall back.

## Configuration

- `VECTOR_MAX_TURNS`: number of Plan/Act turns to allow (default: 4)
- `VECTOR_USE_OPENROUTER=1`: enable provider path without per‑request credentials
- `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL?`

## Open Items / Next Steps

- Retries/backoff for malformed tool calls.
- Lightweight summarization when messages grow (use `context.ts`).
- Granular budget (token/time) per request.
- Optional allow‑list/deny‑list for tools per session.
- Error messaging for invalid tool args sent back to the model.

Vector/Warp — Multi‑Turn Orchestration Implementation Playbook (Intern Edition)
Audience: New team member (intern) tasked with getting Vector/Warp from demo → multi‑turn, Cline‑style copilot for Roblox Studio.
Goal: Deliver a safe, sequential, proposal‑first tool‑calling loop that can complete 20–50 step tasks (e.g., a farming game scaffold) with approval gates, undo steps, and audit.

0) What you’re building (in one paragraph)
Vector is a Roblox Studio copilot. The Next.js backend plans and proposes one tool call at a time; the Studio plugin previews and applies changes only after approval (each apply = one undo step). Multi‑turn means: request → model proposes → plugin executes → result returned → next proposal → repeat. No parallel API calls. Everything is sequential to stay safe and predictable.

1) Guiding principles
Sequential loop: exactly one OpenRouter request in flight. No parallelism.


Proposal‑first: never write directly; always preview and require explicit approval.


One tool per message: the model picks one tool, we run it, then loop.


Minimal diffs & deltas: smallest possible change every step.


Undoable: all writes wrapped in ChangeHistoryService. One approval = one undo step.


Context discipline: keep conversation small; summarize older turns when near the model limit.


Audit everything: prompts, proposals, tool results, and apply outcomes are persisted.



2) Repository & components (you will touch)
apps/web/ — Next.js backend


app/api/chat — entrypoint that returns proposals


app/api/stream — long‑poll streaming (you’ll add)


app/api/assets/search — catalog search (stub → real)


lib/orchestrator/ — planning + tool loop (your main work)


lib/store/ — sessions, proposals, workflows (file → DB)


lib/templates/ — reusable steps (farming, etc.)


plugin/ — Roblox Studio plugin (Luau)


src/main.server.lua — dock UI + apply logic


src/tools/ — one module per tool; you’ll add a dispatcher



3) Environment (intern setup checklist)
Node & npm: Node 18+ installed.


Run backend locally:


cd warp/apps/web && npm i && npm run dev (served at http://127.0.0.1:3000).


Create .env.local:


VECTOR_USE_OPENROUTER=1


OPENROUTER_API_KEY=<your key>


OPENROUTER_MODEL=moonshotai/kimi-k2:free


VECTOR_PLAN_ACT=1


Roblox Studio plugin settings:


Server Base URL: http://127.0.0.1:3000


Provider: openrouter


Provider Base URL: https://openrouter.ai/api/v1


API Key + Model ID: same as .env.local


First‑run permissions: Allow HTTP domain and Script Modification when prompted.


Smoke test: Open a Script in Studio → ask Vector to “rename selected Part to Door” → approve.

4) Architecture overview (how data flows)
User asks in the plugin chat.


Plugin captures context (ActiveScript text, selection) and posts to /api/chat.


Orchestrator (Node) calls LLM, enforcing one tool per message.


Orchestrator returns a proposal (edit/object/asset operation).


Plugin shows diff/op preview → user Approves → plugin executes inside ChangeHistoryService.


Plugin reports apply result to backend (audit), and the loop continues.



5) Phase roadmap (what to build, in order)
Phase A — Multi‑turn sequential loop (core brain)
Objective: Cline‑style loop: request → tool proposal → apply → result → next request.
You will:
Add a Workflow state object (id, steps, currentStep, status, context) persisted to file (dev) then DB.


Implement the task loop:


Call provider (OpenRouter) once; stream tokens; parse a single tool call.


Convert tool call → proposal; send to plugin.


Wait for Approve and apply result.


Append tool result to conversation.


Loop to the next step until done or paused.


Add argument‑validation retries (zod) up to 2 times; on repeated failure, ask user to narrow context.


Add a Context Manager: when nearing token limits, summarize older turns into a compact “history so far.”


Deliverables:
lib/orchestrator/index.ts with initiateTaskLoop(projectId, userMessage, context).


lib/store/workflows.* with CRUD for workflow JSON (dev).


Streaming hooks (emit lightweight status chunks like “planning…”, “step 3/18 …”).


Acceptance criteria:
A prompt like “create a 3×3 grid of Soil tiles under Workspace/Farm” progresses through ≥3 sequential proposals, one approval per step.


No parallel calls; log shows exactly one provider call per step.


Common pitfalls & fixes:
Model emits two tools in one message: reject and instruct model to follow “one tool per message” rule in the next prompt.


Tool args missing/invalid: bounce back a validation error and retry once with the error visible in the model input.



Phase B — Plugin unified dispatcher + safe application
Objective: All tools route through one dispatcher; each approved change = one undo step.
You will:
Create src/tools/dispatch.lua that:


Looks up the tool module by name.


If mutating, wraps execution in ChangeHistoryService:TryBeginRecording/FinishRecording.


Returns { ok, error, result } consistently.


Update main.server.lua to only apply proposals via the dispatcher.


Deliverables:
Dispatcher module + refactor existing tool calls to use it.


Acceptance criteria:
Approving a proposal produces exactly one undo step.


Unknown tool name produces a friendly error and blocks apply.


Pitfalls:
Forgetting to end the change recording → leaves Studio in a weird state. Always FinishRecording in pcall finally.



Phase C — Edit safety (no stale diffs)
Objective: Prevent applying diffs against changed files.
You will:
On the backend, include a beforeHash in edit proposals (hash of the source version used to compute the diff).


In the plugin, before UpdateSourceAsync, recompute the current hash; if mismatched, show “File changed — Re‑preview” and abort.


Ensure minimal diffs: merge ranges server‑side, but verify again before apply.


Deliverables:
Edit proposals with { path, edits[], beforeHash }.


Plugin check that blocks on mismatch and offers a re‑preview action.


Acceptance criteria:
If the user types into the editor after preview, the apply is blocked until re‑preview.



Phase D — Long‑poll streaming (user feedback)
Objective: Show progress updates without WebSockets.
You will:
Add /api/stream that blocks up to ~25s and returns { cursor, chunks[] }.


Start one poller in the plugin per running task; never more than 1 request at a time.


Stream small status messages (e.g., “planning…”, “executed create_instance: OK”).


Deliverables:
app/api/stream route


Plugin poller with backoff and abort controls


Acceptance criteria:
During a multi‑step task, the chat shows intermittent status without freezing.



Phase E — Real Catalog + thumbnails
Objective: Replace stubbed asset search with server‑side Creator Store search and proxied thumbnails.
You will:
Implement a server function that calls the catalog/Creator Store, normalizes to { id, name, creator, type, thumbnailUrl }.


Add a thumbnail proxy endpoint with caching headers to avoid mixed content/CORS issues.


Update the plugin picker to render a grid: thumbnail + name + Insert.


Deliverables:
lib/catalog/search.* + /api/assets/search


/api/assets/thumb/:id (proxy)


Acceptance criteria:
Searching “tree” shows real items with thumbnails; Insert succeeds and reports the inserted paths.



Phase F — Persistence (production)
Objective: Move from JSON files (dev) to a database for proposals/workflows/audit.
You will:
Add Prisma + Postgres (e.g., Neon) and define tables: proposals, workflows, workflow_steps, audit.


Replace filesystem persistence with Prisma calls.


Keep the same interfaces so controllers don’t change.


Deliverables:
Prisma schema + migration


Updated stores using Prisma


Acceptance criteria:
New proposals and workflow states survive redeploys and are filterable by projectId/status.


Pitfalls:
Don’t use SQLite on serverless; file writes aren’t durable. Prefer Postgres.



Phase G — Templates (Farming)
Objective: Ship a reusable template pack for farming games to make plans reliable.
You will:
Create lib/templates/farming.* with atomic steps (farm base, tile grid, crop module, tools).


Add a simple selector that detects “farming” in the request and prepends these steps before calling the model.


Deliverables:
Template definitions + selector hook in the planner


Acceptance criteria:
“Make me a small farming game (10×10 grid)” yields a ~15–20 step plan mixing templates + model steps.



Phase H — Recovery & resume
Objective: Recover from step failures and resume after interruptions.
You will:
On tool failure, choose: retry (tweak args), skip, ask user, or rollback (rare).


Add /api/workflows/:id/resume to continue from last incomplete step.


Plugin UI: show a small card with Retry/Skip/Ask/Resume actions.


Deliverables:
Recovery helper + resume route


Acceptance criteria:
For a bad parent path, recovery suggests a valid fallback (e.g., Workspace) and completes after retry.



Phase I — Tests & observability
Objective: Confidence via repeatable runs and metrics.
You will:
Add a small E2E script that requests a 5×5 grid and asserts the expected counts and names.


Log per‑step latencies and error types.


Deliverables:
E2E test script + a basic /metrics JSON for local debugging


Acceptance criteria:
p95 step time (excluding LLM) < 2s; >95% step success after one retry.



6) Definition of Done (per phase)
Loop: sequential, one tool per turn, no parallel calls; can complete a 3×3 grid task.


Dispatcher: every mutating tool is wrapped in a single undoable recording; unknown tools fail gracefully.


Edits: beforeHash check blocks stale applies; re‑preview flow works.


Streaming: long‑poll updates visible during multi‑step tasks; only one poller active.


Catalog: results with thumbnails; Insert reports inserted paths.


Persistence: data survives restarts; can filter proposals by projectId.


Templates: farming request results in 15–20 small steps; each is atomic and reversible.


Recovery: at least Retry and Ask paths working; Resume continues where left off.


Tests/metrics: basic pass/fail counts; latency logs.



7) Risk list & mitigations
Race conditions: avoided by single‑threaded loop + explicit approvals.


Context overflow: summarize early and often; keep “tools list + last N turns + summary”.


LLM tool misuse (multiple tools at once): enforce schema; reject and restate the rule in the next prompt.


Stale diffs: beforeHash guard + re‑preview.


Studio permissions: document first‑run HTTP and Script Modification prompts.


Serverless durability: use Postgres, not SQLite files, in production.



8) Operational runbooks (intern cheat‑sheet)
Local dev:
Backend: npm run dev in apps/web.


Env: edit .env.local and restart on changes.


Plugin: open Vector dock → Settings → enter provider + Base URL.


Common errors & fixes:
“No provider configured” → check .env.local and plugin settings.


“Tool not found” → dispatcher table missing; add the module.


Apply fails with “File changed” → re‑preview (user edited between preview and apply).


Long‑poll timeouts → expected every 25s with empty chunk list; the poller should loop.


Deploy (later):
Push to GitHub → import to Vercel → set env vars in Vercel project → point plugin to Vercel URL → Allow domain prompts in Studio.



9) Milestone timeline (suggested)
Week 1: Phase A (loop) + Phase B (dispatcher) → 3×3 grid demo.


Week 2: Phase C (edit safety) + Phase D (streaming) → safe user experience.


Week 3: Phase E (catalog) + Phase F (persistence) → production ready.


Week 4: Phase G (templates) + Phase H (recovery) + Phase I (tests/metrics) → complex scenarios.



10) Quality bar (what “done well” looks like)
The intern can run through a farming game demo end‑to‑end with < 2 clicks per step.


Every applied change is undoable; errors are clear; re‑preview is obvious.


Logs make it trivial to answer: What step failed? Why? What did we retry?


No hidden writes; proposals are always explicit and minimal.



11) Glossary (quick reference)
Proposal: A structured, human‑readable summary of the next tool call (edit/object/asset op) awaiting approval.


Tool call: The strict machine‑readable action (name + args) sent to the plugin once approved.


Plan/Act: Optional mode where the model first plans multiple atomic steps (Plan), then executes them one by one (Act).


Context Manager: Keeps conversation within token limits; summarizes older turns.


Long‑poll: A request that waits (up to ~25s) for new chunks, then returns and is immediately re‑issued.



Final note
When unsure, bias for smaller steps, more previews, and fewer side effects. That’s what makes Vector feel trustworthy in Roblox Studio.

Appendix A — API Contracts & Schemas (copy‑paste reference)
This appendix defines the exact request/response shapes so backend ↔ plugin ↔ UI stay in lock‑step. Keep these stable; treat breaking changes like API version bumps.
A.1 /api/chat (POST)
Purpose: Given a user message + minimal context, return one actionable proposal (Cline‑style: one tool per message).
Request (JSON):
projectId: string — stable id for the open Studio project/session


message: string — the user’s latest instruction


context: object — minimal state


activeScript?: { path: string, text: string } | null


selection?: Array<{ className: string, name: string, path: string }>


openDocs?: Array<{ path: string }> (optional)


(optional for multi‑turn) workflowId?: string, approvedStepId?: number


Response (JSON):
workflowId: string


proposals: Proposal[] (0 or 1; never more than 1 in a turn)


isComplete: boolean


Proposal (discriminated union):
Common fields: id: string, kind: 'edit'|'object_op'|'asset_op', notes?: string


edit: { path: string, diff: { mode:'rangeEDITS', edits: Edit[] }, beforeHash?: string }


object_op: { ops: Array<{ op:'create_instance'|'set_properties'|'rename_instance'|'delete_instance', ...args }>}


asset_op: { search?: { query:string, tags?:string[], limit?:number }, insert?: { assetId:number, parentPath?:string } }


Edit: { start:{line:number,character:number}, end:{line:number,character:number}, text:string } (zero‑based positions)
Apply acknowledgment (plugin → backend): POST /api/proposals/:id/apply
Request: { ok:boolean, error?:string, metadata?:any }


Response: { recorded:true }


A.2 /api/stream (GET)
Purpose: Long‑poll for status/text chunks. One poller per running task.
Query: ?projectId=…&cursor=0
Response: { cursor:number, chunks:string[] } (empty array on timeout is normal)
Producer rule: Each time the orchestrator has something user‑visible ("planning…", "executed create_instance OK", partial tokens), push a short string into the queue and increment cursor.
A.3 /api/assets/search (GET)
Query: ?query=tree&limit=12&tags=model (normalize server‑side)
Response: { results: Array<{ id:number, name:string, creator:string, type:string, thumbnailUrl?:string }> }
A.4 /api/assets/thumb/:id (GET)
Purpose: Proxy real thumbnails with caching; avoids CORS/mixed‑content.
—
Appendix B — State Machines (authoritative)
B.1 Workflow status
planning → executing → (paused | completed | failed)
planning: creating an initial step plan (optional)


executing: normal loop; exactly one provider call at a time


paused: waiting for user input or external dependency


completed: all steps done


failed: unrecoverable error (should be rare)


B.2 Step status
pending → approved → executing → (completed | failed)
pending: surfaced to user, awaiting approval


approved: user pressed Approve


executing: plugin/tool is running


completed: apply acknowledged


failed: tool error; feed into recovery flow


B.3 Approval flow (edits)
previewed → approved → applyAttempt → (applied | conflict)
conflict: beforeHash mismatch or editor is dirty in conflicting range → show Re‑preview and don’t write


—
Appendix C — Context & Summarization Policy
Model context ceiling: assume 128k tokens max; set a working budget at ~80%.


Keep in full: system prompt, tools list, last N=6 user/assistant turns, last K=3 tool results.


Compact: turns older than N → single running summary under 800–1200 tokens.


Summary template: capture (a) user goal, (b) accepted proposals, (c) tool results (paths/names), (d) open blockers.


When to summarize: if (inTokens + outTokens + cacheReads + cacheWrites) > 80% budget, compress before next provider call.


—
Appendix D — Retries, Timeouts, and Backoff
Provider (OpenRouter):


Timeout per call: 60–90s


Retries: 2 on 5xx/429 with exponential backoff (1s → 3s)


On validation error (zod): reflect the error message verbatim into the next prompt and retry 1 time


Tools (plugin):


Do not auto‑retry mutating operations; surface the error and offer Retry proposal


Loop breaker: if consecutiveMistakeCount >= 3, pause and ask user to narrow scope


—
Appendix E — Logging & Observability
Correlation ids: always log workflowId, stepId, proposalId, projectId.


Structured logs: { t, level, event, ids..., attrs }


Events: provider.request, provider.response, proposal.created, proposal.approved, tool.execute, tool.result, apply.ack, error.validation, error.provider, error.tool.


Metrics (counters): steps_total, steps_failed_total, retries_total, user_reject_total.


Latencies (histograms): provider_latency_ms, tool_latency_ms, apply_latency_ms (target p95 < 2s excluding model time).


—
Appendix F — Security & Permissions
Secrets: provider API keys belong in backend env or local plugin settings; never checked into git.


Studio permissions: first network call triggers HTTP domain prompt; first write triggers Script Modification — document this in the README for testers.


Network policy: the plugin calls only your backend; the backend calls Roblox/LLM APIs.


Data minimization: send only minimal context (active script text, selection metadata). Avoid dumping entire place contents.


—
Appendix G — Database Model (production)
Tables: proposals, workflows, workflow_steps, audit


Indexes: (projectId), (workflowId), (status), (createdAt) for listings


Enums: ProposalKind, WorkflowStatus, StepStatus (map to strings for portability)


Audit record: { id, at, who:'plugin'|'server', event, payloadJson }


Retention: keep full audit for 30–90 days in staging; 180+ in prod (configurable)


—
Appendix H — Performance & Cost Controls
Max steps per workflow cycle: 6 per /api/chat response window; persist and continue.


Hard cap per workflow: default 50 steps (config).


Rate limits: throttle to ≤ 1 provider call in flight; plugin caps to ≤ 2 HTTP requests total.


Dry‑run mode: preview‑only; disables apply_edit/mutations (useful for demos/tests).


—
Appendix I — UX Details (non‑negotiables)
Diff viewer: always shows line numbers and contextual hunks; Approve disabled if editor is dirty since preview.


Progress bar: currentStep/totalSteps with succinct label (imperative verb + target path).


Toasts:


Success: “✅ Applied edit to …. 1 undo step created.”


Conflict: “⚠️ File changed since preview. Re‑preview your changes.”


Error: friendly description + “Retry” CTA.


Asset picker: thumbnails, name, creator; clearly indicate where insert will occur (parent path).


—
Appendix J — Testing Plan
Unit (backend): proposals builder, zod schemas, context summarizer, retries/backoff logic.


Unit (plugin): dispatcher behavior, ChangeHistory wrapping, UpdateSourceAsync call path.


Integration: /api/chat → proposal → Approve → /apply audit.


Scenario tests: 3×3 soil grid, rename batch, insert asset + post‑configure.


Manual Studio checklist: first‑run permissions, conflict block, undo works, long‑poll heartbeat.


—
Appendix K — Runbooks
Provider 5xx/429 storms: reduce concurrency to 0, surface banner in UI, auto‑retry later.


Catalog API down: fall back to cached/stubbed results; disable Insert buttons.


High failure rate on a tool: pause workflow; open debug drawer with last tool args and error.


Long‑poll drift: reset cursor and reconnect; ensure only one poller exists.


—
Appendix L — Env Matrix (dev → prod)
Var
Dev (.env.local)
Prod (Vercel)
Notes
VECTOR_USE_OPENROUTER
1
1
feature flag to use OpenRouter path
OPENROUTER_API_KEY
personal key
project secret
never in repo
OPENROUTER_MODEL
moonshotai/kimi-k2:free
chosen prod model
overridable in plugin settings
VECTOR_PLAN_ACT
1
1
enables planning loop
CATALOG_API_URL
(unset)
real URL
enables real asset search
DATABASE_URL
(unset)
Neon Postgres DSN
only for prod/persisted staging

—
Appendix M — Milestone Exit Criteria (checklist)
A (Loop): sequential calls verified; 3×3 grid completes without manual fixes


B (Dispatcher): every mutation creates one undo step; unknown tools error gracefully


C (Edit safety): beforeHash conflicts block apply; re‑preview flow tested


D (Streaming): long‑poll UI shows progress; at most one poller active


E (Catalog): real results + thumbs; Insert works and reports paths


F (Persistence): workflows/audit survive redeploy; filtered listings exist


G (Templates): farming demo produces 15–20 atomic steps; user approves each


H (Recovery/Resume): at least Retry + Ask flows implemented; resume works after restart


I (Tests/Metrics): scenario suite passes; latency and failure metrics visible


—
Appendix N — Glossary (expanded)
Approval gate: explicit user action that authorizes exactly one tool execution


Atomic step: smallest change that produces a visible, testable result and a single undo unit


Context compaction: summarizing older conversation turns to reclaim tokens


Dry‑run: mode where proposals are generated but no writes are allowed


Hunk (diff): contiguous block of changed lines with minimal surrounding context


