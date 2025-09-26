import fs from 'fs'
import path from 'path'

const DEFAULT_ROOT = process.env.VECTOR_WORKSPACE_ROOT
  ? path.resolve(process.env.VECTOR_WORKSPACE_ROOT)
  : path.resolve(process.cwd(), '..', '..')

const IGNORE_DIRS = new Set(['node_modules', '.git', '.next', 'data', 'logs', 'build', 'dist'])
const DEFAULT_EXTS = ['.lua', '.luau', '.ts', '.tsx', '.js', '.jsx', '.json']

export type DefinitionInfo = { file: string; line: number; name: string }
export type SearchHit = { file: string; line: number; snippet: string }

const definitionCache = new Map<string, DefinitionInfo[]>()

function clamp(value: number, minValue: number, maxValue: number): number {
  if (value < minValue) return minValue
  if (value > maxValue) return maxValue
  return value
}

function sanitizeDefinition(entry: any): DefinitionInfo | null {
  if (!entry || typeof entry !== 'object') return null
  const file = typeof entry.file === 'string'
    ? entry.file
    : typeof entry.path === 'string'
      ? entry.path
      : undefined
  if (!file) return null
  const name = typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name.trim() : null
  if (!name) return null
  const rawLine = typeof entry.line === 'number' ? entry.line : Number(entry.line)
  if (!Number.isFinite(rawLine)) return null
  const line = clamp(Math.floor(rawLine), 1, 1_000_000)
  return { file, line, name }
}

function normalizeExts(exts?: string[]): string[] {
  if (!Array.isArray(exts)) return []
  const out: string[] = []
  for (const ext of exts) {
    if (typeof ext !== 'string') continue
    const trimmed = ext.trim()
    if (!trimmed) continue
    out.push(trimmed.startsWith('.') ? trimmed.toLowerCase() : `.${trimmed.toLowerCase()}`)
  }
  return out
}

export function setCodeDefinitionCache(taskId: string | undefined, entries: Iterable<any> | null | undefined): DefinitionInfo[] {
  if (!taskId) return []
  const sanitized: DefinitionInfo[] = []
  const seen = new Set<string>()
  if (entries) {
    for (const entry of entries) {
      const info = sanitizeDefinition(entry)
      if (!info) continue
      const dedupeKey = `${info.file}::${info.line}::${info.name}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      sanitized.push(info)
    }
  }
  definitionCache.set(taskId, sanitized)
  return sanitized
}

export function getCodeDefinitionCache(taskId: string | undefined): DefinitionInfo[] {
  if (!taskId) return []
  return definitionCache.get(taskId) ?? []
}

function filterByRoot(defs: DefinitionInfo[], root?: string): DefinitionInfo[] {
  const trimmed = typeof root === 'string' ? root.trim() : ''
  if (!trimmed) return defs
  const needle = trimmed.toLowerCase()
  const altNeedle = needle.startsWith('game.') ? needle.slice(5) : `game.${needle}`
  return defs.filter(({ file }) => {
    const haystack = file.toLowerCase()
    if (haystack.includes(needle)) return true
    if (altNeedle && haystack.includes(altNeedle)) return true
    return false
  })
}

function filterByExts(defs: DefinitionInfo[], exts: string[]): DefinitionInfo[] {
  if (!exts.length) return defs
  const hasLuauExt = exts.some((ext) => ext === '.lua' || ext === '.luau')
  return defs.filter(({ file }) => {
    if (hasLuauExt) return true
    const lower = file.toLowerCase()
    return exts.some((ext) => lower.endsWith(ext))
  })
}

function isIgnored(dirName: string): boolean {
  return IGNORE_DIRS.has(dirName)
}

function enumerateFiles(root: string, limit: number, exts: string[]): string[] {
  const queue: string[] = [root]
  const out: string[] = []
  while (queue.length && out.length < limit) {
    const current = queue.shift()!
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.DS_Store')) continue
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (isIgnored(entry.name)) continue
        queue.push(abs)
      } else if (entry.isFile()) {
        if (!exts.length || exts.includes(path.extname(entry.name))) {
          out.push(abs)
          if (out.length >= limit) break
        }
      }
    }
  }
  return out
}

export function listCodeDefinitionNames(taskId: string | undefined, opts: { root?: string; limit?: number; exts?: string[] } = {}): DefinitionInfo[] {
  const limit = clamp(Math.floor(opts.limit ?? 200), 1, 1000)
  const defs = taskId ? definitionCache.get(taskId) ?? [] : []
  if (!defs.length) return []
  const filteredByRoot = filterByRoot(defs, opts.root)
  const exts = normalizeExts(opts.exts)
  const filtered = filterByExts(filteredByRoot, exts)
  return filtered.slice(0, limit)
}

export function searchFiles(opts: { query: string; root?: string; limit?: number; exts?: string[] } & { caseSensitive?: boolean }): SearchHit[] {
  const query = opts.query
  if (!query) return []
  const root = opts.root ? path.resolve(DEFAULT_ROOT, opts.root) : DEFAULT_ROOT
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100)
  const exts = opts.exts && opts.exts.length ? opts.exts.map((e) => (e.startsWith('.') ? e : `.${e}`)) : DEFAULT_EXTS
  const files = enumerateFiles(root, 600, exts)
  const hits: SearchHit[] = []
  const regex = opts.caseSensitive ? new RegExp(query, 'g') : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig')

  for (const file of files) {
    if (hits.length >= limit) break
    let text: string
    try {
      text = fs.readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length && hits.length < limit; i++) {
      const line = lines[i]
      if (!regex.test(line)) {
        regex.lastIndex = 0
        continue
      }
      const snippet = clampSnippet(line.trim(), 240)
      hits.push({ file: path.relative(DEFAULT_ROOT, file), line: i + 1, snippet })
      regex.lastIndex = 0
    }
  }
  return hits
}

function clampSnippet(text: string, max = 240): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}
