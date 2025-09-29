# store

State persistence and streaming utilities.

## Files
- `persist.ts` – Persistence layer helpers.
- `proposals.ts` – Proposal storage logic.
- `sessions.ts` – Session data handling.
- `stream.ts` – Streaming primitives (SSE / incremental updates).
- `workflows.ts` – Workflow storage & retrieval.

## Guidelines
- Keep store modules focused: one domain per file.
- Avoid circular imports; extract shared types to `types/` if needed.
