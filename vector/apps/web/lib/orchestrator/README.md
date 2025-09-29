# Orchestrator

Coordinates multi-step tasks, provider execution, prompt assembly, and proposal workflows.

## Notable Files
- `index.ts` – Entry for orchestration logic.
- `providers/` – Model provider adapters (OpenAI, Gemini, Bedrock, OpenRouter).
- `prompts/` – Example and system prompts.
- `sceneGraph.ts` – Represents task/node relationships.
- `taskState.ts` – State tracking for tasks.
- `proposals.ts` / `autoApprove.ts` – Proposal generation and auto-approval logic.

## Extending Providers
Add a new file under `providers/` exporting a standardized interface (see existing providers for shape).
