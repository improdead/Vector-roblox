/* Workflow smoke test: plan-first + asset-first for hospital */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadDotEnvLocal() {
  try {
    const p = resolve(__dirname, '..', '.env.local')
    const text = readFileSync(p, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim()
      if (!(key in process.env)) process.env[key] = val
    }
  } catch {}
}

async function main() {
  loadDotEnvLocal()
  const { runLLM } = await import('../lib/orchestrator')
  const workflowId = `wf_test_${Date.now().toString(36)}`
  console.log(`[workflow.test] using workflowId=${workflowId}`)

  // Step 1: request a plan only
  const msg1 = 'Build a hospital into the scene. Return exactly one <start_plan> and then stop.'
  const r1 = await runLLM({
    projectId: 'local',
    workflowId,
    message: msg1,
    context: { activeScript: null, selection: [], scene: {} },
    mode: 'agent',
    maxTurns: 1,
    modelOverride: process.env.BEDROCK_MODEL || process.env.AWS_BEDROCK_MODEL || 'qwen.qwen3-coder-30b-a3b-v1:0',
  } as any)
  const steps = r1.taskState?.plan?.steps || []
  console.log(`[workflow.test] plan.steps=${steps.length}`)
  for (const s of steps) console.log(' -', s)

  // Step 2: approve and expect asset-first search
  const r2 = await runLLM({
    projectId: 'local',
    workflowId,
    message: 'proceed',
    context: { activeScript: null, selection: [], scene: {} },
    mode: 'agent',
    maxTurns: 1,
    modelOverride: process.env.BEDROCK_MODEL || process.env.AWS_BEDROCK_MODEL || 'qwen.qwen3-coder-30b-a3b-v1:0',
  } as any)
  const types = (r2.proposals || []).map((p: any) => p?.type)
  const gotSearch = (r2.proposals || []).some((p: any) => p?.type === 'asset_op' && p?.search)
  console.log(`[workflow.test] second.turn proposals=${types.join(',') || 'none'} asset_search=${gotSearch}`)
  if (!gotSearch) {
    console.warn('[workflow.test] WARN: did not see asset search on second turn — check provider output and policy')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

