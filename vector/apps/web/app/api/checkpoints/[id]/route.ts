export const runtime = 'nodejs'

import { NextRequest } from 'next/server'
import { getCheckpointManifest } from '../../../../lib/checkpoints/manager'

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const checkpointId = ctx?.params?.id
  const workflowId = req.nextUrl.searchParams.get('workflowId') || undefined
  if (!checkpointId || !workflowId) {
    return new Response(JSON.stringify({ error: 'checkpoint id and workflowId required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  const manifest = await getCheckpointManifest(workflowId, checkpointId)
  if (!manifest) {
    return new Response(JSON.stringify({ error: 'checkpoint not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }
  return Response.json({ checkpoint: manifest })
}
