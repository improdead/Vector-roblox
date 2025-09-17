export const runtime = 'nodejs'

function headerAuthBearer(req: Request): string | undefined {
  const h = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!h) return undefined
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1] : undefined
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as any
  const prompt: string = typeof body.prompt === 'string' ? body.prompt : ''
  const style: string | undefined = typeof body.style === 'string' ? body.style : undefined
  const tags: string[] | undefined = Array.isArray(body.tags) ? body.tags.map(String) : undefined
  const budget: number | undefined = typeof body.budget === 'number' ? body.budget : undefined
  if (!prompt || !prompt.trim()) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), { status: 400, headers: { 'content-type': 'application/json' } })
  }

  const apiKey = headerAuthBearer(req) || process.env.MESHY_API_KEY
  const baseUrl = (process.env.MESHY_API_URL || 'https://api.meshy.ai/openapi/v2/text-to-3d').replace(/\/$/, '')
  const timeoutMs = Number(process.env.MESHY_TIMEOUT_MS || 45000)

  if (!apiKey) {
    const jobId = `gpu_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
    console.warn('[assets.generate3d] no MESHY_API_KEY provided; returning stub jobId')
    return Response.json({ jobId, prompt, provider: 'stub' })
  }

  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // Minimal payload. Meshy accepts additional options; we map basic fields only.
    const payload: Record<string, any> = { prompt }
    if (style) payload.art_style = style
    if (Array.isArray(tags) && tags.length) payload.tags = tags
    if (typeof budget === 'number') payload.budget = budget

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      console.error(`[assets.generate3d] meshy error status=${res.status} bodyLen=${text.length}`)
      return new Response(JSON.stringify({ error: `meshy ${res.status}`, details: text.slice(0, 2000) }), { status: 502, headers: { 'content-type': 'application/json' } })
    }
    const js = text ? JSON.parse(text) : {}
    const jobId: string = js.task_id || js.id || js.jobId || `meshy_${Math.random().toString(36).slice(2, 8)}`
    console.log(`[assets.generate3d] meshy ok promptLen=${prompt.length} jobId=${jobId}`)
    return Response.json({ jobId, prompt, provider: 'meshy' })
  } catch (e: any) {
    console.error(`[assets.generate3d] meshy exception ${e?.message || 'unknown'}`)
    return new Response(JSON.stringify({ error: 'meshy_fetch_failed', message: e?.message || 'unknown' }), { status: 504, headers: { 'content-type': 'application/json' } })
  } finally {
    clearTimeout(id)
  }
}
