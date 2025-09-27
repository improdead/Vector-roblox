export type CatalogItem = { id: number; name: string; creator: string; type: string; thumbnailUrl?: string }

type CatalogSearchOptions = {
  tags?: string[]
}

const ROBLOX_CATALOG_URL = 'https://catalog.roblox.com/v1/search/items/details'
const ROBLOX_THUMBNAIL_URL = 'https://thumbnails.roblox.com/v1/assets'
const ROBLOX_ALLOWED_LIMITS = [10, 28, 30] as const

const TAG_CATEGORY_MAP: Record<string, 'Models' | 'Audio' | 'Decals' | 'Animations'> = {
  audio: 'Audio',
  music: 'Audio',
  sound: 'Audio',
  song: 'Audio',
  sfx: 'Audio',
  decal: 'Decals',
  image: 'Decals',
  sticker: 'Decals',
  texture: 'Decals',
  animation: 'Animations',
  dance: 'Animations',
  idle: 'Animations',
  loop: 'Animations',
  model: 'Models',
  mesh: 'Models',
  building: 'Models',
  prop: 'Models',
  vehicle: 'Models',
  '3d': 'Models',
}

const ASSET_TYPE_NAMES: Record<number, string> = {
  8: 'Model',
  10: 'Pants',
  11: 'Decal',
  18: 'Animation',
  19: 'Audio',
  24: 'Hat',
  27: 'Mesh',
  46: 'MeshPart',
  61: 'Animation',
  65: 'Video',
  66: 'Font',
  67: 'Plugin',
}

function normalizeString(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function pickRobloxLimit(limit: number): number {
  const safe = Math.max(1, Math.min(50, Number.isFinite(limit) ? limit : 8))
  for (const allowed of ROBLOX_ALLOWED_LIMITS) {
    if (safe <= allowed) return allowed
  }
  return ROBLOX_ALLOWED_LIMITS[ROBLOX_ALLOWED_LIMITS.length - 1]
}

function deriveCategory(tags?: string[]): 'Models' | 'Audio' | 'Decals' | 'Animations' | 'All' {
  if (!Array.isArray(tags)) return 'Models'
  for (const raw of tags) {
    const normalized = raw?.toString().toLowerCase().trim()
    if (!normalized) continue
    const mapped = TAG_CATEGORY_MAP[normalized]
    if (mapped) return mapped
  }
  return 'Models'
}

function assetTypeLabel(assetType?: number | null): string {
  if (typeof assetType !== 'number') return 'Asset'
  return ASSET_TYPE_NAMES[assetType] || `Asset (${assetType})`
}

async function fetchRobloxThumbnails(ids: number[]): Promise<Map<number, string>> {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === 'number')))
  if (unique.length === 0) return new Map()
  const params = new URLSearchParams({
    assetIds: unique.slice(0, 100).join(','),
    size: '150x150',
    format: 'Png',
    isCircular: 'false',
  })
  const res = await fetch(`${ROBLOX_THUMBNAIL_URL}?${params.toString()}`)
  if (!res.ok) return new Map()
  const payload = (await res.json()) as { data?: { targetId?: number; imageUrl?: string }[] }
  const map = new Map<number, string>()
  for (const item of payload.data ?? []) {
    if (item && typeof item.targetId === 'number' && typeof item.imageUrl === 'string') {
      map.set(item.targetId, item.imageUrl)
    }
  }
  return map
}

async function fetchFromRoblox(query: string, limit: number, opts?: CatalogSearchOptions): Promise<CatalogItem[]> {
  const trimmedQuery = query?.trim() ?? ''
  const desiredLimit = Math.max(1, Math.min(50, Number.isFinite(limit) ? limit : 8))
  const requestLimit = pickRobloxLimit(desiredLimit)
  const category = deriveCategory(opts?.tags)
  const params = new URLSearchParams({
    Category: category,
    Keyword: trimmedQuery || 'asset',
    Limit: String(requestLimit),
    SortAggregation: '3',
    SortType: '3',
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_TIMEOUT_MS || 15000))
  try {
    const res = await fetch(`${ROBLOX_CATALOG_URL}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[catalog] roblox error status=${res.status} q="${trimmedQuery}" category=${category} bodyLen=${body.length}`)
      throw new Error(`Roblox catalog error ${res.status}`)
    }
    const json = (await res.json()) as { data?: any[] }
    const results = Array.isArray(json?.data) ? json.data : []
    const sliced = results.slice(0, desiredLimit)
    const thumbMap = await fetchRobloxThumbnails(sliced.map((item) => item?.id as number))
    const items: CatalogItem[] = []
    for (const entry of sliced) {
      const id = Number(entry?.id)
      if (!Number.isFinite(id)) continue
      items.push({
        id,
        name: typeof entry?.name === 'string' ? entry.name : `Asset ${id}`,
        creator: typeof entry?.creatorName === 'string' ? entry.creatorName : 'Unknown',
        type: assetTypeLabel(entry?.assetType),
        thumbnailUrl: thumbMap.get(id),
      })
    }
    return items
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchFromExternalProvider(baseUrl: string, query: string, limit: number, opts?: CatalogSearchOptions): Promise<CatalogItem[]> {
  const url = new URL(baseUrl)
  url.searchParams.set('query', query)
  url.searchParams.set('limit', String(limit))
  if (opts?.tags?.length) {
    url.searchParams.set('tags', opts.tags.join(','))
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_TIMEOUT_MS || 15000))
  const headers: Record<string, string> = {}
  const apiKey = normalizeString(process.env.CATALOG_API_KEY)
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  try {
    const res = await fetch(url.toString(), { signal: controller.signal, headers })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[catalog] provider error status=${res.status} url=${url.toString()} bodyLen=${body.length}`)
      throw new Error(`Catalog provider error ${res.status}`)
    }
    const json = (await res.json()) as { results?: CatalogItem[] }
    if (!Array.isArray(json?.results)) throw new Error('Invalid catalog response: missing results[]')
    return json.results
  } finally {
    clearTimeout(timeout)
  }
}

export async function searchRobloxCatalog(query: string, limit: number, opts?: CatalogSearchOptions): Promise<CatalogItem[]> {
  const override = normalizeString(process.env.CATALOG_API_URL)
  if (override && override.toLowerCase() !== 'roblox') {
    return fetchFromExternalProvider(override, query, limit, opts)
  }
  return fetchFromRoblox(query, limit, opts)
}
