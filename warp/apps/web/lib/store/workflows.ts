import { readJSON, writeJSON } from './persist'

export type WorkflowStatus = 'planning' | 'executing' | 'paused' | 'completed' | 'failed'
export type StepStatus = 'pending' | 'approved' | 'executing' | 'completed' | 'failed'

export type WorkflowStep = {
  id: string
  index: number
  status: StepStatus
  createdAt: number
  updatedAt: number
  proposalId?: string
  toolName?: string
  error?: string
}

export type Workflow = {
  id: string
  projectId: string
  status: WorkflowStatus
  currentStep: number
  steps: WorkflowStep[]
  context?: any
  createdAt: number
  updatedAt: number
}

const FILE = 'workflows.json'

let map: Map<string, Workflow> = new Map()

function load() {
  const arr = readJSON<Workflow[]>(FILE, [])
  map = new Map(arr.map((w) => [w.id, w]))
}

function flush() {
  writeJSON(FILE, Array.from(map.values()))
}

load()

function newId(prefix = 'wf'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`
}

export function createWorkflow(input: { projectId: string; context?: any }): Workflow {
  const now = Date.now()
  const wf: Workflow = {
    id: newId(),
    projectId: input.projectId,
    status: 'executing',
    currentStep: 0,
    steps: [],
    context: input.context,
    createdAt: now,
    updatedAt: now,
  }
  map.set(wf.id, wf)
  flush()
  return wf
}

export function getWorkflow(id: string): Workflow | undefined {
  return map.get(id)
}

export function listWorkflows(): Workflow[] {
  return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt)
}

export function appendStep(workflowId: string, step: Partial<WorkflowStep> & { id?: string }): WorkflowStep | undefined {
  const wf = map.get(workflowId)
  if (!wf) return undefined
  const now = Date.now()
  const s: WorkflowStep = {
    id: step.id || newId('step'),
    index: wf.steps.length,
    status: step.status || 'pending',
    createdAt: now,
    updatedAt: now,
    proposalId: step.proposalId,
    toolName: step.toolName,
    error: step.error,
  }
  wf.steps.push(s)
  wf.currentStep = s.index
  wf.updatedAt = now
  flush()
  return s
}

export function updateStep(workflowId: string, stepId: string, patch: Partial<WorkflowStep>): WorkflowStep | undefined {
  const wf = map.get(workflowId)
  if (!wf) return undefined
  const s = wf.steps.find((x) => x.id === stepId)
  if (!s) return undefined
  Object.assign(s, patch)
  s.updatedAt = Date.now()
  wf.updatedAt = s.updatedAt
  flush()
  return s
}

export function setWorkflowStatus(workflowId: string, status: WorkflowStatus) {
  const wf = map.get(workflowId)
  if (!wf) return
  wf.status = status
  wf.updatedAt = Date.now()
  flush()
}

