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
    const msg = 'Missing OPENROUTER_API_KEY: provider path disabled. Set OPENROUTER_API_KEY or pass provider.apiKey.'
    console.warn(`[provider.openrouter] ${msg}`)
    throw new Error(msg)
  }
  const model = opts.model || process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2:free'
  const messages: ORMessage[] = [{ role: 'system', content: opts.systemPrompt }, ...opts.messages]

  const url = (opts.baseUrl ? opts.baseUrl.replace(/\/$/, '') + '/chat/completions' : OPENROUTER_URL)
  const timeoutMs = Number(opts.timeoutMs || process.env.OPENROUTER_TIMEOUT_MS || 30000)
  const maxRetries = Math.max(1, Number(process.env.OPENROUTER_MAX_RETRIES || 3))
  let lastError: any

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const attemptLabel = `${attempt + 1}/${maxRetries}`
    const t0 = Date.now()
    try {
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
        console.error(`[provider.openrouter] error attempt=${attemptLabel} status=${res.status} model=${model} base=${opts.baseUrl || 'default'} bodyLen=${text.length}`)
        if (res.status >= 500 && attempt < maxRetries - 1) {
          lastError = new Error(`OpenRouter error ${res.status}: ${text}`)
        } else {
          throw new Error(`OpenRouter error ${res.status}: ${text}`)
        }
      } else {
        const json = (await res.json()) as any
        const content: string = json?.choices?.[0]?.message?.content ?? ''
        const dt = Date.now() - t0
        console.log(`[provider.openrouter] ok attempt=${attemptLabel} model=${model} base=${opts.baseUrl || 'default'} contentLen=${content.length} dtMs=${dt}`)
        return { content }
      }
    } catch (err: any) {
      lastError = err
      if (attempt >= maxRetries - 1) break
      const backoffBase = Number(process.env.OPENROUTER_RETRY_DELAY_MS || 1000)
      const backoff = Math.min(backoffBase * Math.pow(2, attempt), Number(process.env.OPENROUTER_RETRY_MAX_MS || 10000))
      console.warn(`[provider.openrouter] retrying in ${backoff}ms due to ${err?.message || err}`)
      await new Promise((resolve) => setTimeout(resolve, backoff))
    }
  }

  throw new Error(`OpenRouter request failed after ${maxRetries} attempts: ${lastError?.message || lastError || 'unknown error'}`)
}
