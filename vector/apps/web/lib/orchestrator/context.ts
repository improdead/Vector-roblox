export type TokenAccounting = {
  in: number
  out: number
  cacheReads?: number
  cacheWrites?: number
}

export type ContextState = {
  history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  tokens: TokenAccounting
}

export function makeContext(systemPrompt: string): ContextState {
  return {
    history: [{ role: 'system', content: systemPrompt }],
    tokens: { in: 0, out: 0 },
  }
}

export function shouldSummarize(state: ContextState, softLimit = 120000): boolean {
  // Placeholder: return false until a real tokenizer is wired up
  const approx = state.history.map((m) => m.content.length).reduce((a, b) => a + b, 0)
  return approx > softLimit
}

