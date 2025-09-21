import diff3MergeLib from 'diff3'

export type MergeConflict = {
  startLine: number
  endLine: number
  base: string
  current: string
  proposed: string
}

export type MergeOutcome = {
  mergedText: string
  conflicts: MergeConflict[]
}

function normalizeLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n')
}

export function diff3Merge(base: string, current: string, proposed: string): MergeOutcome {
  const baseLines = normalizeLines(base)
  const currentLines = normalizeLines(current)
  const proposedLines = normalizeLines(proposed)
  const merged = diff3MergeLib(currentLines, baseLines, proposedLines)
  const output: string[] = []
  const conflicts: MergeConflict[] = []
  let cursor = 0

  for (const part of merged) {
    if ('ok' in part && part.ok) {
      output.push(...part.ok)
      cursor += part.ok.length
      continue
    }
    if ('conflict' in part && part.conflict) {
      const { a, o, b } = part.conflict
      const baseBlock = (o || []).join('\n')
      const currentBlock = (a || []).join('\n')
      const proposedBlock = (b || []).join('\n')
      const span = Math.max(
        o ? o.length : 0,
        a ? a.length : 0,
        b ? b.length : 0,
      )
      conflicts.push({
        startLine: cursor,
        endLine: cursor + span,
        base: baseBlock,
        current: currentBlock,
        proposed: proposedBlock,
      })
      output.push(...(a || []))
      cursor += a ? a.length : 0
    }
  }

  return { mergedText: output.join('\n'), conflicts }
}
