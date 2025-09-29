# tools

Higher-level tooling abstractions used by the orchestrator or API routes.

## Files
- `codeIntel.ts` – Code intelligence (e.g., symbol extraction, analysis helpers).
- `schemas.ts` – Shared validation or data schemas.

## Notes
Keep tools stateless and pure; side-effects should occur at orchestrator or API layers.
