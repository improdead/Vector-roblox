const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export type ORMessage = { role: 'system' | 'user' | 'assistant'; content: string }

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs, ...rest } = init
  if (!timeoutMs || timeoutMs <= 0) return fetch(input, rest)
  const ac = new AbortController()
  const id = setTimeout(() => ac.abort(), timeoutMs)
  try {
    return await fetch(input, { ...rest, signal: ac.signal })
  } finally {
    clearTimeout(id)
  }
}

export async function callOpenRouter(opts: {
  systemPrompt: string
  messages: ORMessage[]
  model?: string
  apiKey?: string
  baseUrl?: string
  timeoutMs?: number
}): Promise<{ content: string }>
{
  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('Missing OPENROUTER_API_KEY')
  }
  const model = opts.model || process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2:free'
  const messages: ORMessage[] = [{ role: 'system', content: opts.systemPrompt }, ...opts.messages]

  const url = (opts.baseUrl ? opts.baseUrl.replace(/\/$/, '') + '/chat/completions' : OPENROUTER_URL)
  const timeoutMs = Number(opts.timeoutMs || process.env.OPENROUTER_TIMEOUT_MS || 30000)
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Vector',
    },
    body: JSON.stringify({ model, messages }),
    timeoutMs,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenRouter error ${res.status}: ${text}`)
  }
  const json = (await res.json()) as any
  const content: string = json?.choices?.[0]?.message?.content ?? ''
  return { content }
}
