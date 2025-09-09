export const runtime = 'nodejs'

export async function POST(req: Request) {
  const { prompt } = await req.json().catch(() => ({ prompt: '' }))
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), { status: 400, headers: { 'content-type': 'application/json' } })
  }
  // TODO: enqueue a real GPU job and return jobId
  const jobId = `gpu_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
  return Response.json({ jobId, prompt })
}
