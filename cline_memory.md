# Vector Memory Notes

This note captures how Vector currently tracks short‑term state during orchestration and where durable memory could evolve.

## Session State

- In‑memory `sessions` map keyed by `projectId` (see `warp/apps/web/lib/store/sessions.ts`).
- Stores the last executed tool name, result, and timestamp via `setLastTool()`.
- Used to aid follow‑up provider calls and debugging.

## Conversation Context

- `runLLM()` constructs a lightweight chat history during multi‑turn Plan/Act:
  - assistant: the XML tool call emitted by the model
  - user: `TOOL_RESULT <name>` with JSON payload
- This history is sent back to the provider on subsequent turns.

## Token Management (Scaffold)

- `warp/apps/web/lib/orchestrator/context.ts` tracks approximate token sizes and a `shouldSummarize()` hook.
- Not yet wired to summarize; future work can compress prior tool results and/or script text excerpts.

## Persistence

- Proposals are persisted for auditing under `warp/apps/web/data/` via `saveProposals()`.
- Session memory (last tool) is in‑memory only; restarts clear it.
- If needed, persist session state to SQLite/Prisma alongside proposals.

## Future Enhancements

- Add rolling summary messages once history exceeds a soft limit.
- Persist per‑project/user conversation context with TTL.
- Tool result elision (only keep keys referenced later by the model).

