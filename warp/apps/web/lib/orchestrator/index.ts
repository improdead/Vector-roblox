export type EditPos = { line: number; character: number }
export type Edit = { start: EditPos; end: EditPos; text: string }
export type EditProposal = {
  id: string
  type: 'edit'
  path: string
  diff: { mode: 'rangeEDITS'; edits: Edit[] }
  notes?: string
}
export type ObjectOp =
  | { op: 'create_instance'; className: string; parentPath: string; props?: Record<string, unknown> }
  | { op: 'set_properties'; path: string; props: Record<string, unknown> }
  | { op: 'rename_instance'; path: string; newName: string }
  | { op: 'delete_instance'; path: string }
export type ObjectProposal = { id: string; type: 'object_op'; ops: ObjectOp[]; notes?: string }
export type AssetProposal = { id: string; type: 'asset_op'; search?: { query: string; tags?: string[]; limit?: number }; insert?: { assetId: number; parentPath?: string } }
export type Proposal = EditProposal | ObjectProposal | AssetProposal

export type ChatInput = {
  projectId: string
  message: string
  context: {
    activeScript: { path: string; text: string } | null
    selection?: { className: string; path: string }[]
    openDocs?: { path: string }[]
  }
}

function id(prefix = 'p'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`
}

function sanitizeComment(text: string): string {
  return text.replace(/\n/g, ' ').slice(0, 160)
}

// Minimal spike: produce a safe, previewable proposal without real LLMs
import { callOpenRouter } from './providers/openrouter'

const SYSTEM_PROMPT = `You are Vector, a Roblox Studio copilot.
Use exactly ONE tool per message. Propose changes as proposals. Wait for each result.
Never write directly; prefer minimal diffs and property deltas. Reference GetFullName() paths.`

export async function runLLM(input: ChatInput): Promise<Proposal[]> {
  const proposals: Proposal[] = []
  const msg = input.message.trim()

  let providerNote: string | undefined
  if (process.env.VECTOR_USE_OPENROUTER === '1') {
    try {
      const resp = await callOpenRouter({ systemPrompt: SYSTEM_PROMPT, messages: [{ role: 'user', content: msg }] })
      providerNote = resp.content?.slice(0, 300)
    } catch (e: any) {
      providerNote = `OpenRouter error: ${e?.message || 'unknown'}`
    }
  }

  if (input.context.activeScript) {
    const path = input.context.activeScript.path
    const prefixComment = `-- Vector: ${sanitizeComment(msg)}\n`
    proposals.push({
      id: id('edit'),
      type: 'edit',
      path,
      notes: providerNote || 'Insert a comment at the top as a placeholder for an edit.',
      diff: {
        mode: 'rangeEDITS',
        edits: [
          {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
            text: prefixComment,
          },
        ],
      },
    })
  } else if (input.context.selection && input.context.selection.length > 0) {
    // If no active script, propose a harmless object op on first selected instance: rename with suffix
    const first = input.context.selection[0]
    proposals.push({
      id: id('obj'),
      type: 'object_op',
      notes: providerNote || 'Rename selected instance by appending _Warp',
      ops: [
        {
          op: 'rename_instance',
          path: first.path,
          newName: `${first.path.split('.').pop() || 'Instance'}_Warp`,
        },
      ],
    })
  } else {
    // Fallback: no context; suggest searching assets as a placeholder
    proposals.push({
      id: id('asset'),
      type: 'asset_op',
      search: { query: msg || 'button', limit: 6 },
    })
  }

  return proposals
}

