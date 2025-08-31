// Placeholder OpenAI adapter — configure with your API key and model
// This file is intentionally a stub to avoid hardcoding secrets.

export type ToolSpec = {
  name: string
  description?: string
  parameters?: unknown
}

export async function callOpenAI(opts: {
  systemPrompt: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  tools?: ToolSpec[]
  model?: string
}): Promise<{ content: string; toolCall?: { name: string; arguments: unknown } }> {
  throw new Error('OpenAI provider not configured. Provide API key and model, or use OpenRouter/Anthropic adapter.')
}

