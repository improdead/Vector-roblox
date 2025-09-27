import { readJSON, writeJSON } from '../store/persist'
import type { DefinitionInfo } from '../tools/codeIntel'

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string; at: number }
export type ToolRunStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface ToolRun {
  id: string
  tool: string
  input?: unknown
  status: ToolRunStatus
  startedAt?: number
  endedAt?: number
  error?: { message: string; code?: string; retried?: number }
}

export type SceneNode = {
  path: string
  parentPath?: string
  name: string
  className: string
  props: Record<string, unknown>
}

export type SceneGraph = {
  nodes: Record<string, SceneNode>
}

export type PlanState = {
  steps: string[]
  completed: string[]
  currentIndex: number
  notes?: string
}

export type ScriptPolicyState = {
  geometryOps: number
  luauEdits: number
  userOptedOut?: boolean
  lastOptOutAt?: number
  nudgedAt?: number
}

export interface TaskState {
  taskId: string
  history: ChatMessage[]
  runs: ToolRun[]
  streaming: { isStreaming: boolean; indexedUpTo?: number }
  autoApproval: { enabled: boolean; readFiles: boolean; editFiles: boolean; execSafe: boolean }
  counters: { tokensIn: number; tokensOut: number; contextRequests: number }
  scriptSources?: Record<string, string>
  scene?: SceneGraph
  plan?: PlanState
  policy?: ScriptPolicyState
  codeDefinitions?: DefinitionInfo[]
  /**
   * Identifier of the most recently created checkpoint. Mirrors the top-level
   * metadata stored inside `checkpoints` for quick access in the UI.
   */
  lastCheckpointId?: string
  checkpoints?: {
    lastId?: string
    lastNote?: string
    lastCreatedAt?: number
    lastMessageCreatedAt?: number
    count: number
  }
  updatedAt: number
}

const FILE = 'taskStates.json'

let map: Map<string, TaskState> = new Map()

function load() {
  const arr = readJSON<TaskState[]>(FILE, [])
  map = new Map(arr.map((state) => [state.taskId, ensureCheckpointFields(state)]))
}

function flush() {
  writeJSON(FILE, Array.from(map.values()))
}

load()

function ensureCheckpointFields(state: TaskState): TaskState {
  if (!state.checkpoints) {
    state.checkpoints = { count: 0 }
  } else if (typeof state.checkpoints.count !== 'number' || Number.isNaN(state.checkpoints.count)) {
    state.checkpoints.count = Math.max(0, Number(state.checkpoints.count) || 0)
  }
  if (state.checkpoints.lastId && !state.lastCheckpointId) {
    state.lastCheckpointId = state.checkpoints.lastId
  }
  if (state.lastCheckpointId && !state.checkpoints.lastId) {
    state.checkpoints.lastId = state.lastCheckpointId
  }
  if (!state.scriptSources || typeof state.scriptSources !== 'object') {
    state.scriptSources = {}
  }
  if (!Array.isArray(state.codeDefinitions)) {
    state.codeDefinitions = []
  }
  if (!state.scene || typeof state.scene !== 'object' || typeof (state.scene as any).nodes !== 'object') {
    state.scene = { nodes: {} }
  }
  if (!state.plan || !Array.isArray(state.plan.steps)) {
    state.plan = { steps: [], completed: [], currentIndex: 0 }
  }
  if (!state.policy || typeof state.policy !== 'object') {
    state.policy = { geometryOps: 0, luauEdits: 0 }
  } else {
    state.policy.geometryOps = Math.max(0, Number(state.policy.geometryOps) || 0)
    state.policy.luauEdits = Math.max(0, Number(state.policy.luauEdits) || 0)
  }
  return state
}

function defaultState(taskId: string): TaskState {
  const now = Date.now()
  return {
    taskId,
    history: [],
    runs: [],
    streaming: { isStreaming: false },
    autoApproval: { enabled: false, readFiles: false, editFiles: false, execSafe: false },
    counters: { tokensIn: 0, tokensOut: 0, contextRequests: 0 },
    scriptSources: {},
    codeDefinitions: [],
    scene: { nodes: {} },
    plan: { steps: [], completed: [], currentIndex: 0 },
    policy: { geometryOps: 0, luauEdits: 0 },
    checkpoints: { count: 0 },
    updatedAt: now,
  }
}

export function getTaskState(taskId: string): TaskState {
  const existing = map.get(taskId)
  if (existing) return ensureCheckpointFields(existing)
  const state = defaultState(taskId)
  map.set(taskId, state)
  flush()
  return state
}

export function updateTaskState(taskId: string, fn: (state: TaskState) => void): TaskState {
  const state = getTaskState(taskId)
  fn(state)
  state.updatedAt = Date.now()
  ensureCheckpointFields(state)
  map.set(taskId, state)
  flush()
  return state
}

export function resetStreaming(taskId: string) {
  updateTaskState(taskId, (state) => {
    state.streaming.isStreaming = false
    delete state.streaming.indexedUpTo
  })
}

export function replaceTaskState(taskId: string, next: TaskState): TaskState {
  const normalized: TaskState = ensureCheckpointFields({ ...next, taskId })
  normalized.updatedAt = Date.now()
  map.set(taskId, normalized)
  flush()
  return normalized
}
