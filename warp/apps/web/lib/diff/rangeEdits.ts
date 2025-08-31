export type EditPos = { line: number; character: number }
export type Edit = { start: EditPos; end: EditPos; text: string }

function posToIndex(text: string, pos: EditPos): number {
  const lines = text.split('\n')
  const line = Math.max(0, Math.min(pos.line, lines.length))
  const prefix = lines.slice(0, line).join('\n')
  const base = prefix.length + (line > 0 ? 1 : 0)
  return base + Math.max(0, pos.character)
}

export function applyRangeEdits(oldText: string, edits: Edit[]): string {
  if (!Array.isArray(edits) || edits.length === 0) return oldText
  const enriched = edits.map((e) => ({ sidx: posToIndex(oldText, e.start), eidx: posToIndex(oldText, e.end), text: e.text }))
  enriched.sort((a, b) => b.sidx - a.sidx)
  let next = oldText
  for (const e of enriched) {
    next = next.slice(0, e.sidx) + e.text + next.slice(e.eidx)
  }
  return next
}

export function simpleUnifiedDiff(oldText: string, newText: string, path = 'file'): string {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  let j = 0
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++

  const aStart = i + 1
  const bStart = i + 1
  const aCount = Math.max(0, a.length - i - j)
  const bCount = Math.max(0, b.length - i - j)

  const header = [`--- a/${path}`, `+++ b/${path}`, `@@ -${aStart},${aCount} +${bStart},${bCount} @@`]
  const lines: string[] = []
  for (let k = 0; k < aCount; k++) lines.push('-' + a[i + k])
  for (let k = 0; k < bCount; k++) lines.push('+' + b[i + k])
  return header.concat(lines).join('\n')
}

