export const runtime = 'nodejs'

import { NextRequest } from 'next/server'
import { createCheckpoint, listCheckpoints } from '../../../lib/checkpoints/manager'
import { getTaskState, updateTaskState } from '../../../lib/orchestrator/taskState'
import { pushChunk } from '../../../lib/store/stream'

export async function GET(req: NextRequest) {
  const workflowId = req.nextUrl.searchParams.get('workflowId') || undefined
  const list = await listCheckpoints(workflowId)
  return Response.json({ checkpoints: list })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const workflowId = String(body.workflowId || '')
    if (!workflowId) {
      return new Response(JSON.stringify({ error: 'workflowId required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }
    const taskState = getTaskState(workflowId)
    const includeWorkspace = body.includeWorkspace !== false
    pushChunk(workflowId, `checkpoint.create start note=${body.note ? JSON.stringify(body.note) : 'auto'}`)
    const summary = await createCheckpoint({
      workflowId,
      taskState,
      note: body.note,
      proposalId: body.proposalId,
      includeWorkspace,
    })
    const perWorkflow = await listCheckpoints(workflowId)
    const wfCount = perWorkflow.filter((c) => c.workflowId === workflowId).length
    updateTaskState(workflowId, (state) => {
      if (!state.checkpoints) state.checkpoints = { count: 0 }
      state.lastCheckpointId = summary.id
      state.checkpoints.lastId = summary.id
      state.checkpoints.lastNote = summary.note
      state.checkpoints.lastCreatedAt = summary.createdAt
      if (typeof summary.messageCreatedAt === 'number') {
        state.checkpoints.lastMessageCreatedAt = summary.messageCreatedAt
      }
      state.checkpoints.count = wfCount
    })
    pushChunk(workflowId, `checkpoint.create ok id=${summary.id}`)
    return Response.json({ checkpoint: summary })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed to create checkpoint' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}
