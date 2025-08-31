export const runtime = 'nodejs'

import { z } from 'zod'
import { runLLM } from '../../../lib/orchestrator'
import { saveProposals } from '../../../lib/store/proposals'

const ProviderSchema = z.object({
  name: z.literal('openrouter'),
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
  model: z.string().optional(),
}).optional()

const ChatSchema = z.object({
  projectId: z.string(),
  message: z.string(),
  context: z.object({
    activeScript: z.object({ path: z.string(), text: z.string() }).nullable(),
    selection: z.array(z.object({ className: z.string(), path: z.string() })).optional(),
    openDocs: z.array(z.object({ path: z.string() })).optional(),
  }),
  provider: ProviderSchema,
})

export async function POST(req: Request) {
  try {
    const input = ChatSchema.parse(await req.json())
    const proposals = await runLLM(input)

    // Persist proposals for auditing and later apply acknowledgement
    try {
      saveProposals({ projectId: input.projectId, message: input.message, proposals })
    } catch (e) {
      console.warn('failed to persist proposals (non-fatal)', e)
    }

    return Response.json({ proposals })
  } catch (err: any) {
    console.error('chat handler error', err)
    return new Response(
      JSON.stringify({ error: err?.message || 'Invalid request' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )
  }
}
