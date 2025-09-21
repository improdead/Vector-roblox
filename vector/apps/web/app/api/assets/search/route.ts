export const runtime = 'nodejs'

import { searchRobloxCatalog } from '../../../../lib/catalog/search'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const query = searchParams.get('query') || searchParams.get('q') || ''
  const limit = Math.max(1, Math.min(50, Number(searchParams.get('limit') || '8')))
  const t0 = Date.now()
  try {
    const results = await searchRobloxCatalog(query, limit)
    const isStubProvider = !process.env.CATALOG_API_URL
    const hasResults = results.length > 0
    const metadata: Record<string, any> = { isStub: isStubProvider, hasResults }
    if (isStubProvider) {
      metadata.fallbackReason = 'catalog_not_configured'
    } else if (!hasResults) {
      metadata.fallbackReason = 'no_results'
    }
    const dt = Date.now() - t0
    console.log(`[assets.search] q="${query}" limit=${limit} results=${results.length} dtMs=${dt}`)
    return Response.json({ results, query, limit, metadata })
  } catch (err: any) {
    const dt = Date.now() - t0
    console.error(`[assets.search] error q="${query}" limit=${limit} dtMs=${dt} msg=${err?.message || 'unknown'}`)
    return new Response(JSON.stringify({ error: err?.message || 'Catalog provider error', query, limit }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }
}
