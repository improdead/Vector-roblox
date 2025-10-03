# Orchestrator

Coordinates multi-step tasks, provider execution, prompt assembly, and proposal workflows.

## Notable Files
- `index.ts` – Entry for orchestration logic.
- `providers/` – Model provider adapters (OpenAI, Gemini, Bedrock, OpenRouter).
- `prompts/` – Example and system prompts.
- `sceneGraph.ts` – Represents task/node relationships.
- `taskState.ts` – State tracking for tasks.
- `proposals.ts` / `autoApprove.ts` – Proposal generation and auto-approval logic.

## Behaviour Highlights
- Catalog fallback switches the task into **manual mode**. Once enabled, asset search/insert tools are blocked until manual geometry (Parts + Luau) is produced or the user explicitly re-enables catalog usage.
- When a plan already exists, additional `<start_plan>` calls must reuse the same steps; changes require `<update_plan>`.

## Extending Providers
Add a new file under `providers/` exporting a standardized interface (see existing providers for shape).
