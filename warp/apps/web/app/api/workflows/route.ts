export const runtime = 'nodejs'

import { listWorkflows } from '../../../lib/store/workflows'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined
  const all = listWorkflows()
  const filtered = projectId ? all.filter((w) => w.projectId === projectId) : all
  return Response.json({ workflows: filtered })
}

