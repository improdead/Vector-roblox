export const runtime = 'nodejs'

import { getSince, waitForChunks } from '../../../lib/store/stream'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const key = url.searchParams.get('workflowId') || url.searchParams.get('projectId')
  const cursor = Number(url.searchParams.get('cursor') || '0')
  if (!key) {
    return new Response(JSON.stringify({ error: 'Missing workflowId or projectId' }), { status: 400, headers: { 'content-type': 'application/json' } })
  }

  const timeoutMs = 25000
  const result = await waitForChunks(key, cursor, timeoutMs)
  return new Response(
    JSON.stringify({ cursor: result.cursor, chunks: result.chunks.map((c) => c.text) }),
    { headers: { 'content-type': 'application/json' } },
  )
}
