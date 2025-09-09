export const runtime = 'nodejs'

import { listProposals } from "../../../lib/store/proposals"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined
  const all = listProposals()
  const filtered = projectId ? all.filter((p) => p.projectId === projectId) : all
  return Response.json({ proposals: filtered })
}
