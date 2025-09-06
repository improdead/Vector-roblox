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

