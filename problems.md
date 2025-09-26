## Vector codebase problems and stubs (audit)

This document summarizes verified issues, incomplete features, intentional stubs, and a prioritized fix plan.

### Legend
- Critical: breaks core functionality or misdirects tools
- High: missing major feature (MVP gap)
- Medium: polish, correctness, or DX

### Confirmed findings

1) Critical — list_code_definition_names scans local filesystem instead of Roblox Studio
- File: `vector/apps/web/lib/tools/codeIntel.ts`
- Behavior: Enumerates files from `DEFAULT_ROOT` using Node `fs` and regex on local files, not Roblox Studio scripts.
- Impact: The LLM may form code context from the local repo rather than the actual game scripts in Studio.
- Evidence: `enumerateFiles`, `fs.readFileSync`, `DEFAULT_ROOT` usage.
- Fix: Implement a Studio-side tool to enumerate Script/ModuleScript definitions and return `{ path, line, name }` discovered by scanning `ScriptEditorService` sources; or mirror Studio scripts back to the web service and index there.

2) Not an issue (by design) — no plugin tool `show_diff.lua`
- Web schemas include `show_diff`, but the orchestrator maps it into an "edit proposal" with unified diff preview. The plugin renders diffs locally using current editor text and the proposal’s edits; no dedicated plugin tool is required.
- Files: `vector/apps/web/lib/tools/schemas.ts` (schema), `vector/apps/web/lib/orchestrator/index.ts` (maps show_diff/apply_edit to proposals), `vector/plugin/src/main.server.lua` (renders Open Diff UI and applies after a server-side merge).
- Action: None. This is intentional. Keep schema as-is and rely on proposal rendering.

3) High — 3D generation is a stub (no polling or asset upload)
- Files: `vector/apps/web/app/api/assets/generate3d/route.ts`, plugin tool `generate_asset_3d.lua`.
- Behavior: Returns a `jobId` only; no status endpoint, no polling, no Open Cloud upload to produce a real `assetId`.
- Fix: Add `GET /api/assets/generate3d/{jobId}` for status; integrate provider polling and upload to Roblox Open Cloud, then return the final `assetId`.

4) High — Asset catalog search uses stub data when not configured
- File: `vector/apps/web/lib/catalog/search.ts`
- Behavior: If `CATALOG_API_URL` is unset, returns stubbed results.
- Fix: Acceptable for dev; document prominently and add real provider integration (Creator Store proxy + thumbnail handling) for prod.

5) Medium — Context tokenization is a placeholder
- File: `vector/apps/web/lib/orchestrator/context.ts`
- Behavior: `shouldSummarize` uses character count; no tokenizer.
- Fix: Integrate a real tokenizer and summarization strategy to cap history.

6) Medium — list_open_documents is limited (Studio API variance)
- File: `vector/plugin/src/tools/list_open_documents.lua`
- Behavior: Registers `TextDocumentDid*` signals when available; otherwise falls back to the active script only.
- Fix: Acceptable given Studio API variance. Optionally add periodic reconciliation via `ScriptEditorService:Get…` APIs where available.

7) Medium — OpenAI provider is a stub
- File: `vector/apps/web/lib/orchestrator/providers/openai.ts`
- Behavior: Throws by default; not wired anywhere. OpenRouter and Gemini clients are used instead.
- Fix: Either implement fully or leave as documented stub (current code acknowledges this).

8) Clarification — Plugin tools exposure
- Files: `vector/apps/web/lib/tools/schemas.ts`, plugin tools under `vector/plugin/src/tools/`.
- Status: `list_children` and `get_properties` ARE exposed in schemas and implemented in the plugin. No action needed.

9) Medium — File-based persistence (JSON) for proposals/workflows/task state
- Files: `vector/apps/web/lib/store/{persist,proposals,workflows}.ts`, `vector/apps/web/lib/orchestrator/taskState.ts`
- Behavior: Stores to JSON with journaling. Works for dev, not production-ready.
- Fix: Replace with SQLite/Prisma (transactional, indexed, concurrent safe). Keep journaling semantics.

10) Medium — Plugin UI has “not implemented” fallback lines
- File: `vector/plugin/src/main.server.lua` (e.g., title set to "ℹ️ Not implemented yet" in some branches)
- Behavior: Used when a proposal type lacks a handler (e.g., unsupported asset ops).
- Fix: Reduce occurrences as features land (e.g., 3D gen handling). Optional polish.

11) Low — Landing page is a basic stub
- File: `vector/apps/web/app/page.tsx`
- Behavior: Static list of endpoints; fine for dev.
- Fix: Optional: add health checks, env diagnostics, and quick links.

### Additional inconsistencies discovered

- Schema vs mapper: multi-file show_diff inputs are unreachable
  - Schema: `show_diff` schema only allows `{ path, edits }`.
  - Mapper: Orchestrator supports a `{ files: [...] }` branch for multi-file diffs before falling back to single-file.
  - Since Zod objects strip unknown keys by default, a `files` array would be dropped during validation, so the multi-file branch won’t see it.
  - Fix: Extend `show_diff` schema to accept `files: { path: string; edits: Edit[]; baseText?: string }[]` OR mark the schema object as `.passthrough()` and explicitly document the `files[]` form.

- Code intel source of truth mismatch
  - Web’s `codeIntel.ts` indexes local files; the plugin and orchestrator primarily operate on Studio Instances.
  - Fix: add a Studio-side discovery tool for definitions or mirror Studio sources to the web index to maintain a single source of truth.

### Priority fix list

Critical
- Fix `list_code_definition_names` to target Roblox Studio scripts (new plugin tool or a mirror pipeline) so the LLM can understand the actual game code.

High
- Implement the 3D generation job lifecycle: enqueue → poll → upload → return `assetId`.
- Replace file-based persistence with SQLite/Prisma.

Medium
- Resolve `show_diff` multi-file schema mismatch.
- Implement tokenizer-backed summarization.
- Reduce “not implemented yet” UI markers by filling feature gaps.

Low
- Enhance landing page with diagnostics.

### Quick acceptance criteria
- Code intel reflects Studio script definitions and names that match `GetFullName()` paths.
- `POST /api/assets/generate3d` returns a `jobId`; `GET /api/assets/generate3d/{jobId}` returns `{ status, progress, assetId? }` and eventually an `assetId` on success.
- Persistence migrated to SQLite/Prisma with equivalent journaling notes in history/events.
- `show_diff` accepts multi-file proposals through schema without being stripped.

### Notes
- The absence of `show_diff.lua` is intentional; the preview is handled via proposals and rendered in the plugin.
- `list_children` and `get_properties` are exposed and implemented.



