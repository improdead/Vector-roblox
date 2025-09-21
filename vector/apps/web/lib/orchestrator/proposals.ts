import type { Proposal, Edit, EditFileChange } from './index'

export function buildEdit(path: string, edits: Edit[], notes?: string): Proposal {
  const fileChange: EditFileChange = {
    path,
    diff: { mode: 'rangeEDITS', edits },
  }
  return {
    id: `edit_${Math.random().toString(36).slice(2, 8)}`,
    type: 'edit',
    files: [fileChange],
    path,
    notes,
    diff: fileChange.diff,
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
