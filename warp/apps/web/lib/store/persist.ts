import fs from 'fs'
import path from 'path'

const dataDir = path.resolve(process.cwd(), 'data')

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
}

export function readJSON<T>(file: string, fallback: T): T {
  try {
    ensureDir()
    const full = path.join(dataDir, file)
    if (!fs.existsSync(full)) return fallback
    const text = fs.readFileSync(full, 'utf-8')
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export function writeJSON<T>(file: string, value: T): void {
  ensureDir()
  const full = path.join(dataDir, file)
  fs.writeFileSync(full, JSON.stringify(value, null, 2), 'utf-8')
}

