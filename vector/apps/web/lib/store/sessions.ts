type SessionState = {
  lastTool?: { name: string; result: any; at: number }
  updatedAt: number
}

const sessions = new Map<string, SessionState>()

export function getSession(sessionId: string): SessionState {
  const s = sessions.get(sessionId)
  if (s) return s
  const fresh: SessionState = { updatedAt: Date.now() }
  sessions.set(sessionId, fresh)
  return fresh
}

export function setLastTool(sessionId: string, name: string, result: any) {
  const s = getSession(sessionId)
  s.lastTool = { name, result, at: Date.now() }
  s.updatedAt = Date.now()
  sessions.set(sessionId, s)
}

