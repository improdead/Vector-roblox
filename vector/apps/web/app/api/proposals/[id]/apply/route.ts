export const runtime = 'nodejs'

import { markApplied, getProposal } from '../../../../../lib/store/proposals'
import type { StoredProposal } from '../../../../../lib/store/proposals'
import { updateStep } from '../../../../../lib/store/workflows'
import { getTaskState, updateTaskState } from '../../../../../lib/orchestrator/taskState'
import { applyObjectOpResult } from '../../../../../lib/orchestrator/sceneGraph'
import { createCheckpoint, listCheckpoints } from '../../../../../lib/checkpoints/manager'
import { pushChunk } from '../../../../../lib/store/stream'
import { applyRangeEdits } from '../../../../../lib/diff/rangeEdits'
import { diff3Merge } from '../../../../../lib/diff/diff3'
import type { EditProposal, EditFileChange } from '../../../../../lib/orchestrator'

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const id = ctx?.params?.id
  const body = await req.json().catch(() => ({}))

  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing proposal id' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const before = getProposal(id)

  if (body && body.action === 'merge') {
    return handleMerge(id, body, before)
  }

  const after = markApplied(id, body)
  try {
    if (after?.workflowId) {
      updateStep(after.workflowId, id, { status: 'completed' })
      maybeQueueCheckpoint(after.workflowId, after)
    }
  } catch {}
  const op = typeof body?.op === 'string' ? body.op : undefined
  if (op === 'create_instance') {
    const className = typeof body.className === 'string' ? body.className : 'Instance'
    const parentPath = typeof body.parentPath === 'string' ? body.parentPath : 'unknown'
    const instancePath = typeof body.path === 'string' ? body.path : undefined
    if (body?.ok === true) {
      console.log(
        `[proposals.apply] create_instance ok class=${className} parent=${parentPath} path=${instancePath || 'n/a'}`,
      )
    } else if (body?.ok === false) {
      console.warn(
        `[proposals.apply] create_instance failed class=${className} parent=${parentPath} error=${body?.error || 'unknown'}`,
      )
    }
  }
  console.log(
    `[proposals.apply] id=${id} ok=${!!after} workflowId=${after?.workflowId || 'n/a'} payloadKeys=${Object.keys(body || {}).length}`,
  )
  if (after?.workflowId) {
    updateTaskState(after.workflowId, (state) => {
      applyObjectOpResult(state, body)
    })
  }
  return Response.json({ ok: true, id, before, after })
}

async function handleMerge(id: string, body: any, stored?: ReturnType<typeof getProposal>) {
  const proposal = stored?.proposal as EditProposal | undefined
  if (!proposal || proposal.type !== 'edit') {
    return new Response(JSON.stringify({ error: 'Proposal not found or not an edit' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }

  const filesFromBody = Array.isArray(body.files) ? body.files : []
  if (!filesFromBody.length) {
    return new Response(JSON.stringify({ error: 'files[] with currentText required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const workflowId = stored?.workflowId
  const editFiles: EditFileChange[] = Array.isArray(proposal.files) && proposal.files.length
    ? proposal.files
    : proposal.path && proposal.diff
      ? [{ path: proposal.path, diff: proposal.diff, preview: proposal.preview, safety: proposal.safety }]
      : []

  if (!editFiles.length) {
    return new Response(JSON.stringify({ error: 'No edit files recorded' }), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    })
  }

  type MergeResult = {
    path: string
    mergedText: string
    conflicts: ReturnType<typeof diff3Merge>['conflicts']
  }
  const results: MergeResult[] = []
  for (const file of editFiles) {
    const currentEntry = filesFromBody.find((f: any) => f && typeof f.path === 'string' && f.path === file.path)
    if (!currentEntry || typeof currentEntry.currentText !== 'string') {
      return new Response(JSON.stringify({ error: `Missing currentText for ${file.path}` }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }
    const baseText = file.safety?.baseText
    if (typeof baseText !== 'string') {
      return new Response(JSON.stringify({ error: `Base text unavailable for ${file.path}` }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      })
    }
    const proposedText = applyRangeEdits(baseText, file.diff.edits || [])
    const merge = diff3Merge(baseText, currentEntry.currentText, proposedText)
    results.push({ path: file.path, mergedText: merge.mergedText, conflicts: merge.conflicts })
  }

  const hasConflicts = results.some((r) => r.conflicts.length > 0)
  if (hasConflicts) {
    const summary = results
      .filter((r) => r.conflicts.length > 0)
      .map((r) => `${r.path}:${r.conflicts.length}`)
      .join(',')
    if (workflowId) {
      pushChunk(workflowId, `conflict.merge proposal=${id} files=${summary}`)
      const ts = Date.now()
      updateTaskState(workflowId, (state) => {
        state.runs.push({
          id: `conflict_${ts}`,
          tool: 'apply_edit',
          status: 'failed',
          startedAt: ts,
          endedAt: ts,
          error: { message: `Merge conflict ${summary}`, code: 'MERGE_CONFLICT' },
        })
      })
    }
    return new Response(JSON.stringify({ status: 'conflict', files: results }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })
  }

  return Response.json({ status: 'merged', files: results })
}

const lastCheckpointByMessage = new Map<string, number>()
let checkpointQueue = Promise.resolve()

function maybeQueueCheckpoint(workflowId: string, proposal?: StoredProposal) {
  if (!workflowId || !proposal) return
  if (!proposal.createdAt) return
  const last = lastCheckpointByMessage.get(workflowId)
  if (last && last === proposal.createdAt) return
  lastCheckpointByMessage.set(workflowId, proposal.createdAt)
  checkpointQueue = checkpointQueue
    .then(() => autoCheckpoint(workflowId, proposal))
    .catch((err) => {
      lastCheckpointByMessage.delete(workflowId)
      console.warn('[checkpoints] auto queue failed', err)
    })
}

async function autoCheckpoint(workflowId: string, proposal: StoredProposal) {
  try {
    const messageCreatedAt = proposal.createdAt
    pushChunk(workflowId, `checkpoint.auto start proposal=${proposal.id} messageTs=${messageCreatedAt}`)
    const taskState = getTaskState(workflowId)
    const summary = await createCheckpoint({
      workflowId,
      taskState,
      note: 'auto',
      proposalId: proposal.id,
      includeWorkspace: true,
      messageCreatedAt,
    })
    const perWorkflow = await listCheckpoints(workflowId)
    const count = perWorkflow.filter((c) => c.workflowId === workflowId).length
    updateTaskState(workflowId, (state) => {
      if (!state.checkpoints) state.checkpoints = { count: 0 }
      state.lastCheckpointId = summary.id
      state.checkpoints.lastId = summary.id
      state.checkpoints.lastNote = 'auto'
      state.checkpoints.lastCreatedAt = summary.createdAt
      if (typeof summary.messageCreatedAt === 'number') {
        state.checkpoints.lastMessageCreatedAt = summary.messageCreatedAt
      }
      state.checkpoints.count = count
    })
    pushChunk(workflowId, `checkpoint.auto ok id=${summary.id}`)
  } catch (err) {
    lastCheckpointByMessage.delete(workflowId)
    pushChunk(workflowId, `checkpoint.auto error ${(err as Error)?.message || 'failed'}`)
    console.warn('[checkpoints] auto creation failed', err)
  }
}
