export const runtime = 'nodejs'

import { z } from 'zod'
import { runLLM } from '../../../lib/orchestrator'
import { saveProposals } from '../../../lib/store/proposals'

const ProviderSchema = z.object({
  name: z.enum(['openrouter', 'gemini']),
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
  model: z.string().optional(),
}).optional()

const ChatSchema = z.object({
  projectId: z.string(),
  message: z.string(),
  context: z.object({
    // Make activeScript optional to support Studio sending nothing when no script is open
    activeScript: z.object({ path: z.string(), text: z.string() }).nullable().optional(),
    selection: z.array(z.object({ className: z.string(), path: z.string() })).optional(),
    openDocs: z.array(z.object({ path: z.string() })).optional(),
    scene: z
      .object({
        nodes: z
          .array(
            z.object({
              path: z.string(),
              className: z.string(),
              name: z.string(),
              parentPath: z.string().optional(),
              props: z.record(z.any()).optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    codeDefinitions: z
      .array(z.object({ file: z.string(), line: z.number().int().min(1), name: z.string().min(1) }))
      .optional(),
  }),
  provider: ProviderSchema,
  modelOverride: z.string().min(1).optional(),
  autoApply: z.boolean().optional(),
  workflowId: z.string().optional(),
  approvedStepId: z.number().optional(),
  mode: z.enum(['ask', 'agent']).optional(),
  maxTurns: z.number().int().positive().max(16).optional(),
  enableFallbacks: z.boolean().optional(),
})

export async function POST(req: Request) {
  try {
    const input = ChatSchema.parse(await req.json())
    const providerName = input.provider?.name || 'none'
    const model = input.modelOverride || input.provider?.model || 'default'
    const useProvider = !!input.provider?.apiKey
    console.log(
      `[chat] project=${input.projectId} mode=${input.mode || 'agent'} provider=${providerName} model=${model} useProvider=${useProvider} msgLen=${input.message.length}`,
    )
    // Optionally bootstrap a workflow
    const { createWorkflow, getWorkflow, appendStep } = await import('../../../lib/store/workflows')
    const { pushChunk } = await import('../../../lib/store/stream')

    let workflowId = input.workflowId
    if (!workflowId) {
      const wf = createWorkflow({ projectId: input.projectId, context: { approvedStepId: input.approvedStepId } })
      workflowId = wf.id
      pushChunk(workflowId, 'planning: started')
    }

    const { proposals, taskState } = await runLLM(input as any)
    console.log(`[chat] proposals.count=${proposals.length}`)
    const isComplete = proposals.some((p: any) => p && p.type === 'completion')

    // Persist proposals for auditing and later apply acknowledgement
    try {
      const stored = saveProposals({ projectId: input.projectId, workflowId, message: input.message, proposals })
      // Add steps to workflow for each proposal
      for (const p of stored) {
        appendStep(workflowId!, { id: p.id, proposalId: p.id, status: 'pending' })
      }
      console.log(`[chat] proposals.stored=${stored.length} workflowId=${workflowId}`)
    } catch (e) {
      console.warn('[chat] persist.warn non-fatal', e)
    }

    return Response.json({ workflowId, proposals, taskState, isComplete })
  } catch (err: any) {
    const msg = err?.message || 'Unknown error'
    const status = /invalid/i.test(msg) ? 400 : 500
    console.error('[chat] error', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
}
