import { readJSON, writeJSON } from '../store/persist'

export type StoredEvent = { type: string; at: number; data?: any }

export type StoredProposal = {
  id: string
  projectId: string
  workflowId?: string
  message: string
  createdAt: number
  status: 'pending' | 'applied'
  appliedAt?: number
  proposal: any
  events: StoredEvent[]
}

const FILE = 'proposals.json'

let map: Map<string, StoredProposal> = new Map()

function load() {
  const arr = readJSON<StoredProposal[]>(FILE, [])
  map = new Map(arr.map((p) => [p.id, p]))
}

function flush() {
  writeJSON(FILE, Array.from(map.values()))
}

load()

export function saveProposals(input: {
  projectId: string
  workflowId?: string
  message: string
  proposals: any[]
}): StoredProposal[] {
  const now = Date.now()
  const stored: StoredProposal[] = []
  for (const p of input.proposals) {
    const rec: StoredProposal = {
      id: String(p.id),
      projectId: input.projectId,
      workflowId: input.workflowId,
      message: input.message,
      createdAt: now,
      status: 'pending',
      proposal: p,
      events: [{ type: 'created', at: now }],
    }
    map.set(rec.id, rec)
    stored.push(rec)
  }
  flush()
  return stored
}

export function markApplied(id: string, data?: any): StoredProposal | undefined {
  const rec = map.get(id)
  const now = Date.now()
  if (!rec) return undefined
  rec.status = 'applied'
  rec.appliedAt = now
  rec.events.push({ type: 'applied', at: now, data })
  flush()
  return rec
}

export function getProposal(id: string): StoredProposal | undefined {
  return map.get(id)
}

export function listProposals(): StoredProposal[] {
  return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt)
}
