# lib

Core application logic for the web app.

## Submodules
- `catalog/` – Catalog + search utilities.
- `checkpoints/` – State checkpoint management.
- `context/` – Context enrichment utilities (mentions, etc.).
- `diff/` – Diff & merge helpers (e.g., 3-way merge in `diff3.ts`).
- `orchestrator/` – Task orchestration, provider integrations, prompts.
- `store/` – Persistence and reactive data streams.
- `tools/` – Higher-level tools (code intelligence, schemas, etc.).

## Conventions
- Keep pure logic free of framework-specific imports where possible.
- Add tests alongside files (`*.test.ts`).
