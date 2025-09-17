export type CatalogItem = { id: number; name: string; creator: string; type: string; thumbnailUrl?: string }

export async function searchRobloxCatalog(query: string, limit: number): Promise<CatalogItem[]> {
  const url = process.env.CATALOG_API_URL
  // Fallback to stubbed results if no provider URL configured
  if (!url) {
    const q = (query || 'asset').slice(0, 24)
    const n = Math.max(1, Math.min(50, limit || 8))
    console.warn(`[catalog] stub provider enabled; set CATALOG_API_URL. q="${q}" limit=${n}`)
    return Array.from({ length: n }).map((_, i) => ({
      id: 100000 + i,
      name: `${q} ${i + 1}`,
      creator: 'StubCreator',
      type: i % 3 === 0 ? 'Model' : i % 3 === 1 ? 'Decal' : 'Mesh',
      thumbnailUrl: undefined,
    }))
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_TIMEOUT_MS || 15000))
  const headers: Record<string, string> = {}
  const apiKey = process.env.CATALOG_API_KEY
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  const reqUrl = `${url}?query=${encodeURIComponent(query)}&limit=${limit}`
  const t0 = Date.now()
  const res = await fetch(reqUrl, { signal: controller.signal, headers })
  clearTimeout(timeout)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(`[catalog] provider error status=${res.status} url=${reqUrl} bodyLen=${text.length}`)
    throw new Error(`Catalog provider error ${res.status}: ${text}`)
  }
  const js = (await res.json()) as { results?: CatalogItem[] }
  if (!Array.isArray(js?.results)) {
    throw new Error('Invalid catalog response: missing results[]')
  }
  const dt = Date.now() - t0
  console.log(`[catalog] provider ok q="${query}" limit=${limit} results=${js.results?.length || 0} dtMs=${dt}`)
  return js.results
}
