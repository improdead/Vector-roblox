Title: Vector: Provider settings in Studio, secrets hygiene, and API polish

Summary
- Add in‑Studio provider settings panel (Base URL, API Key, Model ID) to avoid committing secrets.
- Wire provider config from plugin -> /api/chat -> orchestrator -> OpenRouter.
- Standardize `parentPath` for create_instance; accept `query` in assets search.
- Apply auditing from plugin to `/api/proposals/:id/apply` and persist on server.
- Harden Instance path resolution and UI canvas sizing.
- Add .gitignore to exclude env files and local `data/`.
- Redact previously committed `.env` and remove from git tracking.

Details
- Plugin (Luau)
  - New toolbar button: "Vector Settings" with Base URL, API Key, Model ID.
  - Sends `provider` in chat body when API key is present.
  - Reports apply outcomes for edits/object ops to `/api/proposals/:id/apply`.
  - Greedy `resolveByFullName` handles names with dots; fixed ScrollingFrame sizing.

- Web (Next.js)
  - /api/chat accepts optional `provider` and passes to orchestrator.
  - OpenRouter adapter takes `apiKey` and `baseUrl` per request; falls back to env only if not provided.
  - Asset search reads `query` (fallback `q`) and clamps `limit`; calls catalog helper.
  - Tools schema standardized to `parentPath` and tolerates legacy `parent`.
  - File‑backed proposal store; apply route marks proposals as applied.
  - .gitignore added for env and local data.

Docs
- Warp.md updated with Local Provider Settings section and run instructions.

Breakage/Compatibility
- No breaking API changes for plugin; server remains backward‑compatible.
- If any scripts/tools referenced `parent` param directly in server schemas, they should update to `parentPath` (compat shim remains in zod).

Testing
- Local dev: `cd warp/apps/web && npm install && npm run dev`.
- In Studio: open Vector Settings, set Base URL (OpenRouter), API key, Model ID; send prompt; approve sample proposal; observe audit call.

