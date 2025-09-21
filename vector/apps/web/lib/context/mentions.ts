import fs from 'fs'
import path from 'path'

// Resolve workspace root with validation and clear logging to aid debugging
const DEFAULT_ROOT = (() => {
  const envRoot = process.env.VECTOR_WORKSPACE_ROOT
  if (envRoot) {
    const resolved = path.resolve(envRoot)
    try {
      if (fs.existsSync(resolved)) {
        return resolved
      }
      // eslint-disable-next-line no-console
      console.warn(`[mentions] VECTOR_WORKSPACE_ROOT does not exist: ${resolved}. Falling back to project root.`)
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[mentions] Failed to access VECTOR_WORKSPACE_ROOT; falling back to project root.')
    }
  }
  const fallback = path.resolve(process.cwd(), '..', '..')
  // eslint-disable-next-line no-console
  console.log(`[mentions] Using workspace root: ${fallback}`)
  return fallback
})()

export type MentionAttachment = {
  type: 'file' | 'folder' | 'url' | 'problems'
  label: string
  content: string
}

function clamp(text: string, max = 4000): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n...[truncated]`
}

const FILE_BYTE_LIMIT = 64 * 1024 // 64KB

function safeResolve(target: string): string | undefined {
  const trimmed = target.trim()
  if (!trimmed) return undefined
  const resolved = path.resolve(DEFAULT_ROOT, trimmed)
  if (!resolved.startsWith(DEFAULT_ROOT)) return undefined
  return resolved
}

type CacheEntry = { mtimeMs: number; content: string }

const fileCache = new Map<string, CacheEntry>()
const folderCache = new Map<string, CacheEntry>()
const urlCache = new Map<string, { fetchedAt: number; content: string }>()

function readFileLimited(absPath: string, size: number): string {
  if (size <= FILE_BYTE_LIMIT) {
    try {
      return fs.readFileSync(absPath, 'utf-8')
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(`[mentions] Error reading file ${absPath}: ${err?.message || err}`)
      return ''
    }
  }
  let fd: number | null = null
  try {
    fd = fs.openSync(absPath, 'r')
    const buffer = Buffer.alloc(FILE_BYTE_LIMIT)
    const bytes = fs.readSync(fd, buffer, 0, FILE_BYTE_LIMIT, 0)
    return buffer.toString('utf-8', 0, bytes)
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(`[mentions] Error reading (limited) file ${absPath}: ${err?.message || err}`)
    return ''
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd) } catch { /* ignore close errors */ }
    }
  }
}

function formatFileAttachment(absPath: string, relLabel: string): MentionAttachment | undefined {
  if (!fs.existsSync(absPath)) return undefined
  const stat = fs.statSync(absPath)
  if (!stat.isFile()) return undefined
  const cached = fileCache.get(absPath)
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return { type: 'file', label: relLabel, content: cached.content }
  }
  const raw = readFileLimited(absPath, stat.size)
  const content = clamp(raw, 20000)
  fileCache.set(absPath, { mtimeMs: stat.mtimeMs, content })
  return { type: 'file', label: relLabel, content }
}

function formatFolderAttachment(absPath: string, relLabel: string): MentionAttachment | undefined {
  if (!fs.existsSync(absPath)) return undefined
  const stat = fs.statSync(absPath)
  if (!stat.isDirectory()) return undefined
  const cached = folderCache.get(absPath)
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return { type: 'folder', label: relLabel, content: cached.content }
  }
  const entries = fs.readdirSync(absPath, { withFileTypes: true })
  const lines: string[] = []
  for (const entry of entries.slice(0, 50)) {
    lines.push(`${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`)
  }
  if (entries.length > 50) lines.push(`... (+${entries.length - 50} more)`)
  const content = lines.join('\n')
  folderCache.set(absPath, { mtimeMs: stat.mtimeMs, content })
  return { type: 'folder', label: relLabel, content }
}

async function fetchUrlAttachment(url: string): Promise<MentionAttachment | undefined> {
  if (!/^https?:\/\//i.test(url)) return undefined
  const cached = urlCache.get(url)
  const now = Date.now()
  if (cached && now - cached.fetchedAt < 5 * 60 * 1000) {
    return { type: 'url', label: url, content: cached.content }
  }
  try {
    const res = await fetch(url, { method: 'GET' })
    if (!res.ok) return { type: 'url', label: url, content: `HTTP ${res.status}` }
    const text = await res.text()
    const content = clamp(text, 8000)
    urlCache.set(url, { fetchedAt: now, content })
    return { type: 'url', label: url, content }
  } catch (err: any) {
    return { type: 'url', label: url, content: `Fetch error: ${err?.message || 'unknown'}` }
  }
}

const mentionPattern = /@(file|folder|url|problems)\s+("[^"]+"|'[^']+'|\S+)/gi

function loadProblemsAttachment(token?: string): MentionAttachment | undefined {
  const fallback = process.env.VECTOR_PROBLEMS_FILE
    ? path.resolve(process.env.VECTOR_PROBLEMS_FILE)
    : path.resolve(DEFAULT_ROOT, 'problems.log')
  const abs = token ? safeResolve(token) : fallback
  if (!abs) return { type: 'problems', label: token || 'problems', content: 'Problem file path not allowed.' }
  if (!fs.existsSync(abs)) {
    return { type: 'problems', label: path.relative(DEFAULT_ROOT, abs), content: 'No problem file found.' }
  }
  const stat = fs.statSync(abs)
  const cached = fileCache.get(abs)
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return { type: 'problems', label: path.relative(DEFAULT_ROOT, abs), content: cached.content }
  }
  const raw = readFileLimited(abs, stat.size)
  let content: string
  try {
    const parsed = JSON.parse(raw)
    content = clamp(JSON.stringify(parsed, null, 2), 20000)
  } catch {
    content = clamp(raw, 20000)
  }
  fileCache.set(abs, { mtimeMs: stat.mtimeMs, content })
  return { type: 'problems', label: path.relative(DEFAULT_ROOT, abs), content }
}

export async function extractMentions(message: string): Promise<{ cleaned: string; attachments: MentionAttachment[] }> {
  const attachments: MentionAttachment[] = []
  let cleaned = message
  const tasks: Promise<void>[] = []

  cleaned = cleaned.replace(mentionPattern, (_match, kind: string, raw: string) => {
    const token = raw.startsWith('"') || raw.startsWith('\'') ? raw.slice(1, -1) : raw
    if (kind === 'file' || kind === 'folder') {
      const resolved = safeResolve(token)
      if (resolved) {
        const rel = path.relative(DEFAULT_ROOT, resolved) || resolved
        if (kind === 'file') {
          const attachment = formatFileAttachment(resolved, rel)
          if (attachment) attachments.push(attachment)
        } else {
          const attachment = formatFolderAttachment(resolved, rel)
          if (attachment) attachments.push(attachment)
        }
      }
    } else if (kind === 'url') {
      tasks.push(
        fetchUrlAttachment(token).then((attachment) => {
          if (attachment) attachments.push(attachment)
        }),
      )
    } else if (kind === 'problems') {
      const attachment = loadProblemsAttachment(token === '-' ? undefined : token)
      if (attachment) attachments.push(attachment)
    }
    return ''
  })

  if (tasks.length) await Promise.all(tasks)

  return { cleaned: cleaned.trim(), attachments }
}
