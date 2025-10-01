import type { ORMessage } from './openrouter'

function normalize(value?: string | null): string | undefined {
  const t = typeof value === 'string' ? value.trim() : ''
  return t.length > 0 ? t : undefined
}

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

function toOpenAIChat(systemPrompt: string | undefined, messages: ORMessage[]) {
  const arr: { role: 'system' | 'user' | 'assistant'; content: string }[] = []
  if (systemPrompt && systemPrompt.trim().length > 0) arr.push({ role: 'system', content: systemPrompt })
  for (const m of messages) arr.push({ role: m.role, content: m.content })
  return arr
}

export async function callNvidia(opts: {
  systemPrompt?: string
  messages: ORMessage[]
  model?: string
  apiKey?: string
  baseUrl?: string
  deploymentId?: string
  timeoutMs?: number
}): Promise<{ content: string }>
{
  const debug = (process.env.NVIDIA_DEBUG || process.env.VECTOR_DEBUG || '0') === '1'
  const apiKey = normalize(opts.apiKey) || normalize(process.env.NVIDIA_API_KEY) || normalize(process.env.NVIDIA_VIM_API_KEY)
  if (!apiKey) {
    throw new Error('Missing NVIDIA_API_KEY (or NVIDIA_VIM_API_KEY): set it or pass provider.apiKey for NVIDIA.')
  }
  const model = normalize(opts.model) || normalize(process.env.NVIDIA_MODEL) || 'qwen3-coder-480b-a35b-instruct'
  const base = normalize(opts.baseUrl) || normalize(process.env.NVIDIA_API_BASE_URL)
  const defaultBases = ['https://ai.api.nvidia.com/v1', 'https://integrate.api.nvidia.com/v1']
  const bases = base ? [base] : defaultBases
  const deploymentId = normalize(opts.deploymentId) || normalize(process.env.NVIDIA_DEPLOYMENT_ID)
  const timeoutMs = Number(opts.timeoutMs || process.env.NVIDIA_TIMEOUT_MS || 30000)

  const body = {
    model,
    messages: toOpenAIChat(opts.systemPrompt, opts.messages),
  }

  const t0 = Date.now()
  if (debug) console.log(`[provider.nvidia] start model=${model} bases=${bases.join(',')} msgs=${opts.messages?.length ?? 0}`)
  let lastErr: any
  for (const baseUrlRaw of bases) {
    if (!baseUrlRaw) continue
    const baseUrl = baseUrlRaw.replace(/\/$/, '')
    const isIntegrate = /integrate\.api\.nvidia\.com/i.test(baseUrl)
    const candidateUrls = [
      `${baseUrl}/chat/completions`,
      `${baseUrl}/completions`,
      `${baseUrl}/responses`,
    ]
    for (const url of candidateUrls) {
      try {
        if (debug) console.log(`[provider.nvidia] try url=${url}`)
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        }
        if (isIntegrate && deploymentId) {
          headers['NVCF-Deployment-Id'] = deploymentId
        }
        const res = await fetchWithTimeout(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          timeoutMs,
        })
        const dt = Date.now() - t0
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          if (debug) console.error(`[provider.nvidia] http ${res.status} url=${url} dtMs=${dt} bodyLen=${text.length} body=${text.slice(0,400)}`)
          if (res.status === 404) {
            const hint = isIntegrate && !deploymentId
              ? ' (missing NVIDIA_DEPLOYMENT_ID when using integrate.api)'
              : ''
            lastErr = new Error(`NVIDIA 404 at ${url}${hint}`)
            continue
          }
          const reason = text ? `: ${text}` : ''
          throw new Error(`NVIDIA error ${res.status}${reason}`)
        }
        const json = (await res.json().catch(() => ({}))) as any
        const content: string = json?.choices?.[0]?.message?.content || json?.output_text || ''
        if (debug) console.log(`[provider.nvidia] ok url=${url} contentLen=${content.length} dtMs=${dt}`)
        if (!content) {
          throw new Error('NVIDIA response missing content')
        }
        return { content }
      } catch (e: any) {
        lastErr = e
      }
    }
  }
  throw new Error(lastErr?.message || 'NVIDIA request failed')
}

