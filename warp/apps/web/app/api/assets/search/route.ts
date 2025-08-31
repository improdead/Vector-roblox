export const runtime = 'nodejs'

import { searchRobloxCatalog } from '../../../../lib/catalog/search'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const query = searchParams.get('query') || searchParams.get('q') || ''
  const limit = Math.max(1, Math.min(50, Number(searchParams.get('limit') || '8')))
  try {
    const results = await searchRobloxCatalog(query, limit)
    return Response.json({ results, query, limit })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Catalog provider error', query, limit }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }
}
