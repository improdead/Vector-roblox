type Chunk = { i: number; t: number; text: string }

const perKey: Map<string, Chunk[]> = new Map()

const MAX_PER_KEY = 200

function arr(key: string): Chunk[] {
  let a = perKey.get(key)
  if (!a) {
    a = []
    perKey.set(key, a)
  }
  return a
}

export function pushChunk(key: string, text: string): number {
  const a = arr(key)
  const last = a.length ? a[a.length - 1].i : 0
  const i = last + 1
  a.push({ i, t: Date.now(), text })
  if (a.length > MAX_PER_KEY) a.splice(0, a.length - MAX_PER_KEY)
  return i
}

export function getSince(key: string, cursor: number): { cursor: number; chunks: string[] } {
  const a = arr(key)
  const fresh = a.filter((c) => c.i > cursor)
  const nextCursor = a.length ? a[a.length - 1].i : cursor
  return { cursor: nextCursor, chunks: fresh.map((c) => c.text) }
}

