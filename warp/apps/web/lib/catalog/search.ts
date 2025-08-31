export type CatalogItem = { id: number; name: string; creator: string; type: string; thumbnailUrl?: string }

export async function searchRobloxCatalog(query: string, limit: number): Promise<CatalogItem[]> {
  // Real integration can be implemented by setting CATALOG_API_URL to a service that returns
  // normalized results: [{ id, name, creator, type, thumbnailUrl }]
  const url = process.env.CATALOG_API_URL
  if (url) {
    try {
      const res = await fetch(`${url}?query=${encodeURIComponent(query)}&limit=${limit}`)
      if (res.ok) {
        const js = (await res.json()) as { results?: CatalogItem[] }
        if (Array.isArray(js?.results)) return js.results
      }
    } catch (e) {
      // fall through to stub
    }
  }
  // Stub fallback
  const samples: CatalogItem[] = [
    { id: 1111111, name: 'Simple Button', creator: 'Roblox', type: 'Model', thumbnailUrl: 'https://tr.rbxcdn.com/4f9b-150x150' },
    { id: 2222222, name: 'Sci-Fi Panel', creator: 'Builder', type: 'Model', thumbnailUrl: 'https://tr.rbxcdn.com/9c2a-150x150' },
    { id: 3333333, name: 'Wooden Crate', creator: 'AssetMaker', type: 'Model', thumbnailUrl: 'https://tr.rbxcdn.com/abcd-150x150' },
    { id: 4444444, name: 'Green Button', creator: 'CreatorX', type: 'Model', thumbnailUrl: 'https://tr.rbxcdn.com/ef12-150x150' },
    { id: 5555555, name: 'Keycard', creator: 'StudioUser', type: 'Model', thumbnailUrl: 'https://tr.rbxcdn.com/12ab-150x150' },
    { id: 6666666, name: 'Door', creator: 'Roblox', type: 'Model', thumbnailUrl: 'https://tr.rbxcdn.com/77aa-150x150' },
  ]
  return samples
}

