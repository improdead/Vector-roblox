export type CatalogItem = { id: number; name: string; creator: string; type: string; thumbnailUrl?: string }

export async function searchRobloxCatalog(query: string, limit: number): Promise<CatalogItem[]> {
  const url = process.env.CATALOG_API_URL
  // Fallback to stubbed results if no provider URL configured
  if (!url) {
    const q = (query || 'asset').slice(0, 24)
    const n = Math.max(1, Math.min(50, limit || 8))
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
  const res = await fetch(`${url}?query=${encodeURIComponent(query)}&limit=${limit}`, { signal: controller.signal, headers })
  clearTimeout(timeout)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Catalog provider error ${res.status}: ${text}`)
  }
  const js = (await res.json()) as { results?: CatalogItem[] }
  if (!Array.isArray(js?.results)) {
    throw new Error('Invalid catalog response: missing results[]')
  }
  return js.results
}
