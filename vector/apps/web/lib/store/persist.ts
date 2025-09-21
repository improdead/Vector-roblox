import fs from 'fs'
import path from 'path'

const dataDir = path.resolve(process.cwd(), 'data')

type JournalEntry<T = any> = {
  ts: number
  op: 'write'
  payload: T
  applied?: boolean
}

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
}

function filePaths(file: string) {
  const full = path.join(dataDir, file)
  const journal = `${full}.journal`
  return { full, journal }
}

function writeFileAtomic(full: string, data: string) {
  const dir = path.dirname(full)
  const tmp = path.join(dir, `${path.basename(full)}.${process.pid}.${Date.now()}.tmp`)
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, data, { encoding: 'utf-8' })
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, full)
}

function readJournalEntries<T>(file: string): JournalEntry<T>[] {
  ensureDir()
  const { journal } = filePaths(file)
  if (!fs.existsSync(journal)) return []
  try {
    const text = fs.readFileSync(journal, 'utf-8')
    if (!text.trim()) return []
    return JSON.parse(text) as JournalEntry<T>[]
  } catch {
    return []
  }
}

function writeJournalEntries<T>(file: string, entries: JournalEntry<T>[]) {
  const { journal } = filePaths(file)
  writeFileAtomic(journal, JSON.stringify(entries, null, 2))
}

function trimJournal<T>(entries: JournalEntry<T>[]): JournalEntry<T>[] {
  const MAX_ENTRIES = 32
  if (entries.length <= MAX_ENTRIES) return entries
  return entries.slice(entries.length - MAX_ENTRIES)
}

export function readJSON<T>(file: string, fallback: T): T {
  ensureDir()
  const { full } = filePaths(file)
  let current: T = fallback
  if (fs.existsSync(full)) {
    try {
      const text = fs.readFileSync(full, 'utf-8')
      current = JSON.parse(text) as T
    } catch {
      current = fallback
    }
  }

  const journal = readJournalEntries<T>(file)
  let journalUpdated = false
  for (const entry of journal) {
    if (!entry) continue
    if (entry.op === 'write' && entry.payload !== undefined) {
      current = entry.payload as T
      if (!entry.applied) {
        writeFileAtomic(full, JSON.stringify(current, null, 2))
        entry.applied = true
        journalUpdated = true
      }
    }
  }

  if (journalUpdated) {
    writeJournalEntries(file, trimJournal(journal))
  }

  return current
}

export function writeJSON<T>(file: string, value: T): void {
  ensureDir()
  const { full } = filePaths(file)
  const entries = readJournalEntries<T>(file)
  const entry: JournalEntry<T> = { ts: Date.now(), op: 'write', payload: value, applied: false }
  entries.push(entry)
  let trimmed = trimJournal(entries)
  writeJournalEntries(file, trimmed)
  writeFileAtomic(full, JSON.stringify(value, null, 2))
  entry.applied = true
  trimmed = trimJournal(entries)
  writeJournalEntries(file, trimmed)
}
