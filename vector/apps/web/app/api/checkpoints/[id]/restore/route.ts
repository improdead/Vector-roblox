export const runtime = 'nodejs'

import { loadCheckpoint, restoreCheckpoint, listCheckpoints } from '../../../../../lib/checkpoints/manager'
import type { CheckpointManifest } from '../../../../../lib/checkpoints/manager'
import { updateTaskState } from '../../../../../lib/orchestrator/taskState'
import { pushChunk } from '../../../../../lib/store/stream'

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const checkpointId = ctx?.params?.id
  if (!checkpointId) {
    return new Response(JSON.stringify({ error: 'Missing checkpoint id' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  let manifestBefore: CheckpointManifest | undefined
  try {
    const body = await req.json().catch(() => ({}))
    const mode = body.mode === 'conversation' || body.mode === 'workspace' ? body.mode : 'both'
    manifestBefore = await loadCheckpoint(checkpointId)
    if (!manifestBefore) {
      return new Response(JSON.stringify({ error: 'Checkpoint not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    pushChunk(manifestBefore.workflowId, `checkpoint.restore start id=${checkpointId} mode=${mode}`)
    const manifest = await restoreCheckpoint({ checkpointId, mode })
    if (!manifest) {
      pushChunk(manifestBefore.workflowId, 'checkpoint.restore error not_found')
      return new Response(JSON.stringify({ error: 'Checkpoint not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    const perWorkflow = await listCheckpoints(manifest.workflowId)
    const count = perWorkflow.filter((c) => c.workflowId === manifest.workflowId).length
    updateTaskState(manifest.workflowId, (state) => {
      if (!state.checkpoints) state.checkpoints = { count: 0 }
      state.lastCheckpointId = manifest.id
      state.checkpoints.lastId = manifest.id
      state.checkpoints.lastNote = manifest.note
      state.checkpoints.lastCreatedAt = manifest.createdAt
      if (typeof manifest.messageCreatedAt === 'number') {
        state.checkpoints.lastMessageCreatedAt = manifest.messageCreatedAt
      }
      state.checkpoints.count = count
    })
    pushChunk(manifest.workflowId, `checkpoint.restore ok id=${manifest.id} mode=${mode}`)
    return Response.json({ checkpoint: manifest, mode })
  } catch (err: any) {
    const streamKey = manifestBefore?.workflowId || (typeof checkpointId === 'string' ? checkpointId : 'checkpoint')
    pushChunk(streamKey, `checkpoint.restore error ${err?.message || 'failed'}`)
    return new Response(JSON.stringify({ error: err?.message || 'Failed to restore checkpoint' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}
