export const runtime = 'nodejs'

import { getSince } from '../../../lib/store/stream'

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

export async function GET(req: Request) {
  const url = new URL(req.url)
  const key = url.searchParams.get('workflowId') || url.searchParams.get('projectId')
  const cursor = Number(url.searchParams.get('cursor') || '0')
  if (!key) {
    return new Response(JSON.stringify({ error: 'Missing workflowId or projectId' }), { status: 400, headers: { 'content-type': 'application/json' } })
  }

  const deadline = Date.now() + 25000
  let next = getSince(key, cursor)
  while (next.chunks.length === 0 && Date.now() < deadline) {
    await sleep(250)
    next = getSince(key, cursor)
  }
  return new Response(JSON.stringify(next), { headers: { 'content-type': 'application/json' } })
}

