import type { ORMessage } from './openrouter'

function normalize(value?: string | null): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : undefined
  return trimmed ? trimmed : undefined
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

function buildConverseEndpoint(region: string, modelId: string): string {
  const r = region.trim()
  const m = modelId.trim()
  return `https://bedrock-runtime.${r}.amazonaws.com/model/${encodeURIComponent(m)}/converse`
}

function buildInvokeEndpoint(region: string, modelId: string): string {
  const r = region.trim()
  const m = modelId.trim()
  return `https://bedrock-runtime.${r}.amazonaws.com/model/${encodeURIComponent(m)}/invoke`
}

type ConverseMessagePart = { type: 'text'; text: string }
type ConverseMessage = { role: 'user' | 'assistant'; content: ConverseMessagePart[] }

function toConverseMessages(messages: ORMessage[]): { messages: ConverseMessage[]; system?: string } {
  const out: ConverseMessage[] = []
  let system: string | undefined

  for (const m of messages) {
    if (m.role === 'system') {
      // The Converse API supports a top-level system string, prefer to place the last system there
      system = typeof m.content === 'string' ? m.content : system
      continue
    }
    // Map assistant/user directly
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    out.push({ role, content: [{ type: 'text', text: String(m.content || '') }] })
  }
  return { messages: out, system }
}

function extractTextFromConverseResponse(json: any): string | undefined {
  const parts = json?.output?.message?.content
  if (Array.isArray(parts)) {
    const texts = parts
      .map((p: any) => (p && typeof p === 'object' && p.type === 'text' ? String(p.text || '') : ''))
      .filter((s: string) => s && s.trim().length > 0)
    const joined = texts.join('').trim()
    if (joined) return joined
  }
  // Some responses might flatten content
  const txt = json?.outputText || json?.content || ''
  if (typeof txt === 'string' && txt.trim().length > 0) return txt
  return undefined
}

function extractTextFromInvokeResponse(json: any): string | undefined {
  // Anthropic-style body: { content: [{ type: 'text', text: '...' }], ... }
  const content = json?.content
  if (Array.isArray(content)) {
    const texts = content
      .map((p: any) => (p && typeof p === 'object' && p.type === 'text' ? String(p.text || '') : ''))
      .filter((s: string) => s && s.trim().length > 0)
    const joined = texts.join('').trim()
    if (joined) return joined
  }
  const txt = json?.outputText || json?.completion || json?.answer || ''
  if (typeof txt === 'string' && txt.trim().length > 0) return txt
  return undefined
}

function extractTextFromOpenAIResponse(json: any): string | undefined {
  // OpenAI-style Chat Completions: { choices:[{ message:{ content:"..." }}] }
  const message = json?.choices?.[0]?.message
  const text = message?.content
  if (typeof text === 'string' && text.trim().length > 0) return text
  // Some models emit { output_text: "..." }
  const fallback = json?.output_text || json?.outputText
  if (typeof fallback === 'string' && fallback.trim().length > 0) return fallback
  return undefined
}

export async function callBedrock(opts: {
  systemPrompt?: string
  messages: ORMessage[]
  model?: string
  apiKey?: string
  region?: string
  timeoutMs?: number
}): Promise<{ content: string }>
{
  const debug = (process.env.BEDROCK_DEBUG || process.env.VECTOR_DEBUG || '0') === '1'
  const apiKey = normalize(opts.apiKey) || normalize(process.env.AWS_BEARER_TOKEN_BEDROCK) || normalize(process.env.AWS_BEDROCK_API_KEY)
  if (!apiKey) {
    throw new Error('Missing AWS_BEARER_TOKEN_BEDROCK (or AWS_BEDROCK_API_KEY): set it or pass provider.apiKey for Bedrock.')
  }

  const model = normalize(opts.model) || normalize(process.env.BEDROCK_MODEL) || normalize(process.env.AWS_BEDROCK_MODEL) || 'anthropic.claude-3-5-sonnet-20240620-v1:0'
  const region = normalize(opts.region) || normalize(process.env.AWS_BEDROCK_REGION) || 'us-east-1'
  const timeoutMs = Number(opts.timeoutMs || process.env.BEDROCK_TIMEOUT_MS || process.env.OPENROUTER_TIMEOUT_MS || 30000)

  const isAnthropic = /^anthropic\./i.test(model)
  const isQwenOrOpenAIStyle = /^qwen\./i.test(model) || /^mistral\./i.test(model) || /^meta\./i.test(model) || /^cohere\./i.test(model) || /^ai21\./i.test(model) || /^amazon\./i.test(model)

  // If model is Anthropic, try Converse first; for others, prefer OpenAI-style Invoke first
  const { messages, system } = toConverseMessages(opts.messages)
  const converseBody: Record<string, unknown> = { messages }
  if (opts.systemPrompt && opts.systemPrompt.trim().length > 0) {
    converseBody.system = opts.systemPrompt
  } else if (system && system.trim().length > 0) {
    converseBody.system = system
  }
  // Basic inference config defaults tuned for tool-emitting prompts
  converseBody.inferenceConfig = {
    maxTokens: Number(process.env.BEDROCK_MAX_TOKENS || 2048),
    temperature: Number(process.env.BEDROCK_TEMPERATURE || 0.3),
    topP: Number(process.env.BEDROCK_TOP_P || 0.9),
  }

  const converseUrl = buildConverseEndpoint(region, model)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  try {
    const t0 = Date.now()
    if (debug) console.log(`[provider.bedrock] converse.start model=${model} region=${region} msgs=${messages.length} timeoutMs=${timeoutMs}`)
    const res = await fetchWithTimeout(converseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(converseBody),
      timeoutMs,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (debug) console.error(`[provider.bedrock] converse.http status=${res.status} bodyLen=${text.length}`)
      throw new Error(`Bedrock converse error ${res.status}: ${text}`)
    }
    const data = await res.json().catch(() => ({}))
    const content = extractTextFromConverseResponse(data)
    if (content && content.trim().length > 0) {
      const dt = Date.now() - t0
      if (debug) console.log(`[provider.bedrock] converse.ok contentLen=${content.length} dtMs=${dt}`)
      return { content }
    }
    // Fall through to invoke parsing if converse lacked content
    if (debug) console.warn('[provider.bedrock] converse.empty → falling back to invoke')
  } catch (err) {
    // Fallback to invoke route
    if (debug) console.warn(`[provider.bedrock] converse.exception ${err instanceof Error ? err.message : String(err)}`)
  }

  const invokeUrl = buildInvokeEndpoint(region, model)
  let invokeBody: any
  let parse = extractTextFromInvokeResponse
  if (isAnthropic) {
    // Anthropic schema
    invokeBody = {
      anthropic_version: normalize(process.env.BEDROCK_ANTHROPIC_VERSION) || 'bedrock-2023-05-31',
      max_tokens: Number(process.env.BEDROCK_MAX_TOKENS || 2048),
      temperature: Number(process.env.BEDROCK_TEMPERATURE || 0.3),
      messages: opts.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: [{ type: 'text', text: String(m.content || '') }] })),
    }
    if (opts.systemPrompt && opts.systemPrompt.trim().length > 0) invokeBody.system = opts.systemPrompt
    parse = extractTextFromInvokeResponse
  } else {
    // OpenAI-compatible schema (Qwen, etc.)
    const messagesOpenAI = [] as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    if (opts.systemPrompt && opts.systemPrompt.trim().length > 0) {
      messagesOpenAI.push({ role: 'system', content: opts.systemPrompt })
    }
    for (const m of opts.messages) {
      if (m.role === 'system') continue
      messagesOpenAI.push({ role: m.role, content: String(m.content || '') })
    }
    invokeBody = {
      messages: messagesOpenAI,
      max_tokens: Number(process.env.BEDROCK_MAX_TOKENS || 2048),
      temperature: Number(process.env.BEDROCK_TEMPERATURE || 0.3),
      top_p: Number(process.env.BEDROCK_TOP_P || 0.9),
    }
    parse = extractTextFromOpenAIResponse
  }

  const t1 = Date.now()
  if (debug) console.log(`[provider.bedrock] invoke.start model=${model} region=${region} msgs=${messages.length} timeoutMs=${timeoutMs}`)
  const res = await fetchWithTimeout(invokeUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(invokeBody),
    timeoutMs,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (debug) console.error(`[provider.bedrock] invoke.http status=${res.status} bodyLen=${text.length}`)
    throw new Error(`Bedrock invoke error ${res.status}: ${text}`)
  }
  const data = await res.json().catch(() => ({}))
  const content = parse(data)
  if (!content || !content.trim()) {
    throw new Error('Bedrock returned empty response')
  }
  const dt = Date.now() - t1
  if (debug) console.log(`[provider.bedrock] invoke.ok contentLen=${content.length} dtMs=${dt}`)
  return { content }
}


