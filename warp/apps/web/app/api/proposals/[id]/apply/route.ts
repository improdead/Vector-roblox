export const runtime = 'nodejs'

import { markApplied, getProposal } from '../../../../../lib/store/proposals'

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const id = ctx?.params?.id
  const body = await req.json().catch(() => ({}))

  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing proposal id' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const before = getProposal(id)
  const after = markApplied(id, body)
  return Response.json({ ok: true, id, before, after })
}
