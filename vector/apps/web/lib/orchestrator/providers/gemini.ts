import type { ORMessage } from './openrouter'

function buildEndpoint(model: string, baseUrl?: string): string {
  const trimmedBase = baseUrl?.replace(/\/$/, '')
  if (trimmedBase) {
    return `${trimmedBase}/${model}:generateContent`
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
}

function toGeminiRole(role: ORMessage['role']): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user'
}

export async function callGemini(opts: {
  systemPrompt?: string
  messages: ORMessage[]
  model?: string
  apiKey?: string
  baseUrl?: string
  timeoutMs?: number
}): Promise<{ content: string }>
{
  const apiKey = opts.apiKey || process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY: set GEMINI_API_KEY or pass provider.apiKey for Gemini.')
  }

  const requestedModel = opts.model && opts.model.trim().length > 0 ? opts.model.trim() : undefined
  const defaultModel = process.env.GEMINI_MODEL && process.env.GEMINI_MODEL.trim().length > 0 ? process.env.GEMINI_MODEL.trim() : 'gemini-2.5-flash'
  const model = requestedModel || defaultModel

  const controller = new AbortController()
  const timeout = opts.timeoutMs && opts.timeoutMs > 0 ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined

  try {
    const payload: Record<string, any> = {
      contents: opts.messages.map((message) => ({
        role: toGeminiRole(message.role),
        parts: [{ text: message.content }],
      })),
    }

    if (opts.systemPrompt && opts.systemPrompt.trim().length > 0) {
      payload.systemInstruction = {
        role: 'system',
        parts: [{ text: opts.systemPrompt }],
      }
    }

    const endpoint = buildEndpoint(model, opts.baseUrl || process.env.GEMINI_API_BASE_URL)
    const url = `${endpoint}?key=${encodeURIComponent(apiKey)}`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-client': 'vector-cli/1.0.0',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Gemini error ${res.status}: ${text}`)
    }

    const data = (await res.json()) as any
    const parts: string[] = Array.isArray(data?.candidates)
      ? (data.candidates[0]?.content?.parts || []).map((part: any) => part?.text || '').filter(Boolean)
      : []
    const content = parts.join('')
    return { content }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
