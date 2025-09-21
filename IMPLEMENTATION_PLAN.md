# Vector Copilot — Implementation Plan (July 2026)

This plan captures what is already delivered and what remains to reach full Cursor/Cline parity.

## ✅ Completed (June 2026)
- Deterministic linting pipeline (`.eslintrc.json`, `npm run lint` as prebuild gate).
- Atomic JSON persistence with journaling (`lib/store/persist.ts`).
- TaskState snapshots, auto-approval metadata, and auto-context retries (`lib/orchestrator/index.ts`, `taskState.ts`).
- Context mentions (`@file/@folder/@url/@problems`) + read-only tools (`list_code_definition_names`, `search_files`).
- Event-driven streaming (`lib/store/stream.ts`) with both improved long-poll and `/api/stream/sse` SSE endpoint.
- Provider retries with exponential backoff (`providers/openrouter.ts`).
- Studio auto-mode respects `meta.autoApproved` while logging skipped proposals.

## 🚀 Next Up (High Priority)
1. **Checkpoint snapshots & selective restore**  
   - Files: `vector/apps/web/lib/checkpoints/*` (new), `/api/checkpoints/*`, `vector/plugin/src/main.server.lua`.  
   - Snapshot TaskState + workspace (zip) after each applied tool; expose create/list/restore endpoints; wire plugin buttons.  
   - DoD: One-click snapshot + restore (conversation, workspace, or both) with audit trail.

2. **Diff/conflict upgrade v1**  
   - Files: `lib/diff/rangeEdits.ts`, `lib/diff/diff3.ts` (new), `/api/proposals/[id]/apply`.  
   - Anchor matching, diff3 multi-file merges, structured conflicts array.  
   - DoD: Apply returns clear conflict hunks; partial successes roll back.

3. **Plugin progress & conflict UI**  
   - Files: `plugin/src/ui/DiffView.lua`, `plugin/src/ui/StatusPanel.lua`, `plugin/src/main.server.lua`.  
   - Side-by-side diff with conflict hunks, progress bar, per-run status badges, checkpoint nav.  
   - DoD: Users can follow execution, resolve conflicts, and revert via UI.

## 🔄 Secondary (Mid-Term)
4. **Catalog thumbnails & proxy caching** (`/api/assets/thumb`).
5. **3D pipeline completion** (Meshy polling + Open Cloud upload).
6. **Packaging & deploy guide** (Vercel project, Studio allowlist, `NEXT_PUBLIC_BACKEND_URL`).
7. **Analysis/CI jobs stubs** (`/api/workflows/analyze`, `/run-tests`, `/snapshot`).
8. **Durable storage option** (SQLite/Prisma dual-mode).
9. **Web dashboard** (browse workflows/proposals, consume SSE).

## 📐 Quality Gates
- `npm run lint`, `npm run build`, and targeted tests must pass before completing a task.
- Checkpoints/diff upgrades require crash and conflict simulations.
- Plugin UI changes validated in Studio until automated harness exists.

## 📓 Documentation Ritual
- Update `IMPLEMENTATION_STATUS.md` and `Vector.md` after each milestone.
- Keep dated changelog bullets (e.g., “2026-07: Checkpoints landed”).

## ⚠️ Risks & Mitigations
- **Large diffs**: diff3 + conflict UI keeps the loop safe; checkpoints allow rollbacks.
- **Roblox API variance**: continue feature detection with fallbacks (as in `list_open_documents`).
- **File-based storage growth**: journal rotation + upcoming checkpoints mitigate.
- **Long auto-runs**: progress UI + snapshots give visibility and escape hatches.
