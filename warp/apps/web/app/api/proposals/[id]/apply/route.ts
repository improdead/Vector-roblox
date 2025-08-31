export const runtime = 'nodejs'

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const id = ctx?.params?.id
  const body = await req.json().catch(() => ({}))
  // TODO: Persist audit record for applied proposal
  return Response.json({ ok: true, id, body })
}

