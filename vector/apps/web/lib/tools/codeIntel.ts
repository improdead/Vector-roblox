import fs from 'fs'
import path from 'path'

const DEFAULT_ROOT = process.env.VECTOR_WORKSPACE_ROOT
  ? path.resolve(process.env.VECTOR_WORKSPACE_ROOT)
  : path.resolve(process.cwd(), '..', '..')

const IGNORE_DIRS = new Set(['node_modules', '.git', '.next', 'data', 'logs', 'build', 'dist'])
const DEFAULT_EXTS = ['.lua', '.luau', '.ts', '.tsx', '.js', '.jsx', '.json']

export type DefinitionInfo = { file: string; line: number; name: string }
export type SearchHit = { file: string; line: number; snippet: string }

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

export function listCodeDefinitionNames(opts: { root?: string; limit?: number; exts?: string[] } = {}): DefinitionInfo[] {
  const root = opts.root ? path.resolve(DEFAULT_ROOT, opts.root) : DEFAULT_ROOT
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000)
  const exts = opts.exts && opts.exts.length ? opts.exts.map((e) => (e.startsWith('.') ? e : `.${e}`)) : DEFAULT_EXTS
  const files = enumerateFiles(root, limit, exts)
  const defs: DefinitionInfo[] = []
  const funcRegex = /(function\s+([A-Za-z0-9_.:]+))|(local\s+function\s+([A-Za-z0-9_.:]+))/g
  files.forEach((file) => {
    try {
      const text = fs.readFileSync(file, 'utf-8')
      const lines = text.split(/\r?\n/)
      lines.forEach((line, idx) => {
        funcRegex.lastIndex = 0
        const match = funcRegex.exec(line)
        if (match) {
          const name = match[2] || match[4]
          if (name) {
            defs.push({ file: path.relative(DEFAULT_ROOT, file), line: idx + 1, name })
          }
        }
      })
    } catch {
      /* noop */
    }
  })
  return defs.slice(0, limit)
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
