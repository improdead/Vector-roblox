import { EventEmitter } from 'node:events'

export type Chunk = { i: number; t: number; text: string }

const perKey: Map<string, Chunk[]> = new Map()
const emitter = new EventEmitter()
emitter.setMaxListeners(0)

const MAX_PER_KEY = 200
const MAX_IDLE_MS = 60 * 60 * 1000 // 1 hour

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
  const chunk: Chunk = { i, t: Date.now(), text }
  a.push(chunk)
  if (a.length > MAX_PER_KEY) a.splice(0, a.length - MAX_PER_KEY)
  emitter.emit(key, chunk)
  return i
}

export function getSince(key: string, cursor: number): { cursor: number; chunks: Chunk[] } {
  const a = arr(key)
  const fresh = a.filter((c) => c.i > cursor)
  const nextCursor = a.length ? a[a.length - 1].i : cursor
  return { cursor: nextCursor, chunks: fresh }
}

export function subscribe(key: string, handler: (chunk: Chunk) => void): () => void {
  const wrapped = (chunk: Chunk) => handler(chunk)
  emitter.on(key, wrapped)
  return () => emitter.off(key, wrapped)
}

export async function waitForChunks(key: string, cursor: number, timeoutMs: number): Promise<{ cursor: number; chunks: Chunk[] }> {
  const existing = getSince(key, cursor)
  if (existing.chunks.length > 0) return existing

  if (timeoutMs <= 0) return existing

  return new Promise((resolve) => {
    let settled = false
    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      unsubscribe()
    }

    const unsubscribe = subscribe(key, () => {
      if (settled) return
      const latest = getSince(key, cursor)
      if (latest.chunks.length > 0) {
        settled = true
        cleanup()
        resolve(latest)
      }
    })

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      resolve(getSince(key, cursor))
    }, timeoutMs)
  })
}

// Periodic cleanup for idle streams to avoid unbounded memory growth
setInterval(() => {
  const now = Date.now()
  for (const [key, chunks] of perKey.entries()) {
    const lastTs = chunks.length ? chunks[chunks.length - 1].t : 0
    if (!chunks.length || now - lastTs > MAX_IDLE_MS) {
      perKey.delete(key)
      emitter.removeAllListeners(key)
      // eslint-disable-next-line no-console
      console.log(`[stream] cleaned idle key=${key}`)
    }
  }
}, 5 * 60 * 1000)

