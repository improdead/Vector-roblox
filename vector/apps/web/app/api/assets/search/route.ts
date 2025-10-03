export const runtime = 'nodejs'

import { searchRobloxCatalog } from '../../../../lib/catalog/search'

function parseTags(params: URLSearchParams): string[] {
  const list: string[] = []
  const csv = params.get('tags')
  if (csv) {
    for (const part of csv.split(',')) {
      const trimmed = part.trim()
      if (trimmed) list.push(trimmed)
    }
  }
  const repeated = params.getAll('tag')
  for (const value of repeated) {
    const trimmed = value.trim()
    if (trimmed) list.push(trimmed)
  }
  return Array.from(new Set(list)).slice(0, 16)
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const query = searchParams.get('query') || searchParams.get('q') || ''
  const tags = parseTags(searchParams)
  const logQuery = query.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80)
  const logTags = tags.map((t) => t.slice(0, 24)).join('|')
  const limit = Math.max(1, Math.min(60, Number(searchParams.get('limit') || '8')))
  const override = process.env.CATALOG_API_URL?.trim()
  const provider = !override || override.toLowerCase() === 'roblox' ? 'roblox' : 'proxy'
  const t0 = Date.now()
  try {
    const results = await searchRobloxCatalog(query, limit, { tags })
    const hasResults = results.length > 0
    const metadata: Record<string, any> = { provider, hasResults, tags }
    if (!hasResults) {
      metadata.fallbackReason = 'no_results'
    }
    const dt = Date.now() - t0
    console.log(`[assets.search] provider=${provider} q="${logQuery}" tags="${logTags}" limit=${limit} results=${results.length} dtMs=${dt}`)
    return Response.json({ results, query, limit, metadata })
  } catch (err: any) {
    const dt = Date.now() - t0
    console.error(`[assets.search] error provider=${provider} q="${logQuery}" tags="${logTags}" limit=${limit} dtMs=${dt} msg=${err?.message || 'unknown'}`)
    return new Response(JSON.stringify({ error: err?.message || 'Catalog provider error', query, limit, tags }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }
}
