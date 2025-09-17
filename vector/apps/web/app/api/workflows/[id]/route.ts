export const runtime = 'nodejs'

import { getWorkflow } from '../../../../lib/store/workflows'

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const id = ctx?.params?.id
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing workflow id' }), { status: 400, headers: { 'content-type': 'application/json' } })
  }
  const wf = getWorkflow(id)
  if (!wf) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
  }
  return Response.json({ workflow: wf })
}

