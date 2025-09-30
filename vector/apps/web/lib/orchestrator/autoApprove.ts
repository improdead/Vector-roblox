import type { Proposal, EditProposal, ObjectProposal, AssetProposal, CompletionProposal } from './index'

const SAFE_PREFIXES = [
  'game.Workspace',
  'game.ReplicatedStorage',
  'game.ServerStorage',
  'game.StarterGui',
  'game.StarterPack',
  'game.StarterPlayer',
  'game.ServerScriptService',
  'game.SoundService',
  'game.TextService',
  'game.CollectionService',
]

function isSafePath(path?: string): boolean {
  if (!path) return false
  return SAFE_PREFIXES.some((prefix) => path.startsWith(prefix))
}

function canAutoApproveEdit(proposal: EditProposal): boolean {
  if (proposal.files && proposal.files.length > 0) {
    return proposal.files.every((file) => isSafePath(file.path))
  }
  return isSafePath(proposal.path)
}

function canAutoApproveObject(proposal: ObjectProposal): boolean {
  return proposal.ops.every((op) => {
    switch (op.op) {
      case 'create_instance':
        return isSafePath(op.parentPath)
      case 'set_properties':
      case 'rename_instance':
      case 'delete_instance':
        return isSafePath(op.path)
      default:
        return false
    }
  })
}

function canAutoApproveAsset(proposal: AssetProposal, opts?: { autoEnabled?: boolean }): boolean {
  // Insert proposals: safe if parentPath is a safe prefix (defaults to Workspace)
  if (proposal.insert) {
    return isSafePath(proposal.insert.parentPath || 'game.Workspace')
  }
  // Search proposals: allow when Auto mode is enabled.
  // The plugin will fetch results and insert at most one best match.
  if (proposal.search && opts?.autoEnabled) {
    return true
  }
  return false
}

export function annotateAutoApproval<T extends Proposal>(proposals: T[], opts: { autoEnabled: boolean }): T[] {
  if (!opts.autoEnabled) {
    return proposals.map((p) => ({ ...p, meta: { ...(p.meta || {}), autoApproved: false } }))
  }
  return proposals.map((p) => {
    let autoApproved = false
    if (p.type === 'edit') autoApproved = canAutoApproveEdit(p as EditProposal)
    if (p.type === 'object_op') autoApproved = canAutoApproveObject(p as ObjectProposal)
    if (p.type === 'asset_op') autoApproved = canAutoApproveAsset(p as AssetProposal, { autoEnabled: opts.autoEnabled })
    if (p.type === 'completion') autoApproved = false
    return { ...p, meta: { ...(p.meta || {}), autoApproved } }
  })
}
