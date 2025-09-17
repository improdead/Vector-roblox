import type { Proposal, Edit } from './index'

export function buildEdit(path: string, edits: Edit[], notes?: string): Proposal {
  return {
    id: `edit_${Math.random().toString(36).slice(2, 8)}`,
    type: 'edit',
    path,
    notes,
    diff: { mode: 'rangeEDITS', edits },
  }
}

export function buildRename(path: string, newName: string, notes?: string): Proposal {
  return {
    id: `obj_${Math.random().toString(36).slice(2, 8)}`,
    type: 'object_op',
    notes,
    ops: [{ op: 'rename_instance', path, newName }],
  } as Proposal
}

