// OpenAI direct API adapter

export type ToolSpec = {
  name: string
  description?: string
  parameters?: unknown
}

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let id: NodeJS.Timeout
  const timeout = new Promise<T>((_, reject) => {
    id = setTimeout(() => reject(new Error(`OpenAI request timeout after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(id!)
  }
}

export async function callOpenAI(opts: {
  systemPrompt: string
  messages: OpenAIMessage[]
  tools?: ToolSpec[]
  model?: string
  apiKey?: string
  baseUrl?: string
  timeoutMs?: number
}): Promise<{ content: string; toolCall?: { name: string; arguments: unknown } }> {
  const apiKey = opts.apiKey || process.env.OPENAI_API_KEY
  const model = opts.model || process.env.OPENAI_MODEL || 'gpt-5-2025-08-07'
  const baseUrl = opts.baseUrl || process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1'
  const timeoutMs = opts.timeoutMs || Number(process.env.OPENAI_TIMEOUT_MS || 30000)

  if (!apiKey) {
    const msg = 'Missing OPENAI_API_KEY: provider disabled. Set OPENAI_API_KEY or pass provider.apiKey.'
    console.warn(`[provider.openai] ${msg}`)
    throw new Error(msg)
  }

  const messages: OpenAIMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    ...opts.messages
  ]

  const url = baseUrl.replace(/\/$/, '') + '/chat/completions'

  const body: any = {
    model,
    messages,
    temperature: 0.3,
    max_tokens: 2048
  }

  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }))
  }

  const debug = (process.env.OPENAI_DEBUG || '0') === '1'
  if (debug) console.log(`[provider.openai] POST ${url} model=${model} msgs=${messages.length}`)

  const t0 = Date.now()
  const response = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    }),
    timeoutMs
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  const elapsed = Date.now() - t0

  if (debug) console.log(`[provider.openai] ← ${elapsed}ms status=${response.status}`)

  const choice = data.choices?.[0]
  if (!choice) {
    throw new Error('OpenAI returned no choices')
  }

  const message = choice.message
  const content = message.content || ''

  // Check for tool calls
  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolCall = message.tool_calls[0]
    const funcCall = toolCall.function

    return {
      content,
      toolCall: {
        name: funcCall.name,
        arguments: JSON.parse(funcCall.arguments || '{}')
      }
    }
  }

  return { content }
}

