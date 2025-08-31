export type CatalogItem = { id: number; name: string; creator: string; type: string; thumbnailUrl?: string }

export async function searchRobloxCatalog(query: string, limit: number): Promise<CatalogItem[]> {
  const url = process.env.CATALOG_API_URL
  if (!url) {
    throw new Error('CATALOG_API_URL not configured')
  }
  const res = await fetch(`${url}?query=${encodeURIComponent(query)}&limit=${limit}`)
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
