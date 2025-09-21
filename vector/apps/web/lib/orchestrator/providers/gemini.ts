import type { ORMessage } from './openrouter'

type GeminiPart = { text?: string }
type GeminiContent = { parts?: GeminiPart[] }
type GeminiCandidate = { content?: GeminiContent; finishReason?: string }
type GeminiResponse = { candidates?: GeminiCandidate[] }

function normalize(value?: string | null): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : undefined
  return trimmed ? trimmed : undefined
}

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
  const apiKey = normalize(opts.apiKey) || normalize(process.env.GEMINI_API_KEY)
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY: set GEMINI_API_KEY or pass provider.apiKey for Gemini.')
  }

  const requestedModel = normalize(opts.model)
  const defaultModel = normalize(process.env.GEMINI_MODEL) || 'gemini-2.5-flash'
  const model = requestedModel || defaultModel

  const controller = new AbortController()
  const timeout = opts.timeoutMs && opts.timeoutMs > 0 ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined

  try {
    const payload: Record<string, unknown> = {
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

    const endpoint = buildEndpoint(model, normalize(opts.baseUrl) || normalize(process.env.GEMINI_API_BASE_URL))
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

    const data = (await res.json()) as GeminiResponse
    const candidate = Array.isArray(data.candidates) ? data.candidates[0] : undefined
    if (!candidate) {
      throw new Error('Gemini returned no candidates')
    }
    const finishReason = candidate.finishReason?.toUpperCase()
    if (finishReason && finishReason.includes('SAFETY')) {
      throw new Error(`Gemini blocked the response (${finishReason})`)
    }
    const parts = candidate.content?.parts?.map((part) => normalize(part.text)).filter((text): text is string => !!text) || []
    const content = parts.join('').trim()
    if (!content) {
      throw new Error('Gemini response was empty')
    }
    return { content }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
