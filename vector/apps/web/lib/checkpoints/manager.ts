import fs from 'fs'
import path from 'path'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { TaskState, replaceTaskState } from '../orchestrator/taskState'

const fsp = fs.promises

const DATA_DIR = path.resolve(process.cwd(), 'data')
const CHECKPOINT_ROOT = path.join(DATA_DIR, 'checkpoints')

const ROOT_DIR = (() => {
  const envRoot = process.env.VECTOR_WORKSPACE_ROOT
  if (envRoot) {
    const resolved = path.resolve(envRoot)
    if (fs.existsSync(resolved)) return resolved
    console.warn(`[checkpoints] VECTOR_WORKSPACE_ROOT does not exist: ${resolved}`)
  }
  const fallback = path.resolve(process.cwd(), '..', '..')
  console.log(`[checkpoints] Using workspace root: ${fallback}`)
  return fallback
})()

const IGNORE_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.next',
  'logs',
  'data',
  'dist',
  'build',
  '.vscode',
  '.idea',
])

const MAX_KEEP = Number(process.env.VECTOR_CHECKPOINT_LIMIT || 10)

export type CheckpointFile = {
  path: string
  size: number
  sha1: string
}

export type CheckpointManifest = {
  id: string
  workflowId: string
  note?: string
  createdAt: number
  proposalId?: string
  messageCreatedAt?: number
  taskState: TaskState
  workspaceRoot: string
  includeWorkspace: boolean
  files?: CheckpointFile[]
  zipSize?: number
}

export type CheckpointSummary = {
  id: string
  workflowId: string
  note?: string
  createdAt: number
  proposalId?: string
  messageCreatedAt?: number
  zipSize?: number
  path: string
}

function checkpointDir(workflowId: string) {
  return path.join(CHECKPOINT_ROOT, workflowId)
}

function checkpointPath(workflowId: string, id: string) {
  return path.join(checkpointDir(workflowId), id)
}

function archivePath(workflowId: string, id: string) {
  return path.join(checkpointPath(workflowId, id), 'workspace.zip')
}

async function ensureDir(dir: string) {
  await fsp.mkdir(dir, { recursive: true })
}

function shouldIgnore(rel: string): boolean {
  if (!rel) return false
  const parts = rel.split(path.sep)
  return parts.some((segment) => IGNORE_SEGMENTS.has(segment))
}

async function collectWorkspaceFiles(root: string) {
  type Entry = { rel: string; abs: string }
  const files: Entry[] = []

  async function walk(dir: string) {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      const rel = path.relative(root, abs)
      if (!rel || shouldIgnore(rel)) continue
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile()) {
        files.push({ rel, abs })
      }
    }
  }

  await walk(root)
  return files
}

function cloneTaskState(state: TaskState): TaskState {
  const cloner = (globalThis as any).structuredClone
  if (typeof cloner === 'function') return cloner(state)
  return JSON.parse(JSON.stringify(state)) as TaskState
}

async function writeManifest(dir: string, manifest: CheckpointManifest) {
  await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
}

async function readManifest(dir: string): Promise<CheckpointManifest | undefined> {
  try {
    const text = await fsp.readFile(path.join(dir, 'manifest.json'), 'utf-8')
    return JSON.parse(text) as CheckpointManifest
  } catch (err) {
    console.warn('[checkpoints] Failed to read manifest for', dir, err)
    return undefined
  }
}

async function clampCheckpoints(workflowId: string) {
  try {
    const dir = checkpointDir(workflowId)
    const entries = await fsp.readdir(dir)
    if (entries.length <= MAX_KEEP) return
    const manifests = await Promise.all(
      entries.map(async (name) => ({
        name,
        manifest: await readManifest(path.join(dir, name)),
      })),
    )
    const sorted = manifests
      .filter((x) => x.manifest)
      .sort((a, b) => (a.manifest!.createdAt || 0) - (b.manifest!.createdAt || 0))
    while (sorted.length > MAX_KEEP) {
      const item = sorted.shift()
      if (!item) break
      try {
        await fsp.rm(path.join(dir, item.name), { recursive: true, force: true })
      } catch (err) {
        console.warn('[checkpoints] Failed to remove old checkpoint', item.name, err)
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[checkpoints] clamp failed', err)
    }
  }
}

async function computeZipFromFiles(workflowId: string, id: string, files: { rel: string; abs: string }[]) {
  const zip = new AdmZip()
  const list: CheckpointFile[] = []
  for (const file of files) {
    try {
      const data = await fsp.readFile(file.abs)
      const hash = crypto.createHash('sha1').update(data).digest('hex')
      zip.addFile(file.rel, data)
      list.push({ path: file.rel, size: data.length, sha1: hash })
    } catch (err) {
      console.warn('[checkpoints] Failed to add file to checkpoint', file.rel, err)
    }
  }
  const archive = archivePath(workflowId, id)
  await ensureDir(path.dirname(archive))
  zip.writeZip(archive)
  let zipSize: number | undefined
  try {
    const stat = await fsp.stat(archive)
    zipSize = stat.size
  } catch {}
  return { files: list, zipSize }
}

export async function createCheckpoint(opts: {
  workflowId: string
  taskState: TaskState
  note?: string
  proposalId?: string
  includeWorkspace?: boolean
  messageCreatedAt?: number
}): Promise<CheckpointSummary> {
  const includeWorkspace = opts.includeWorkspace !== false
  const now = Date.now()
  const id = `ckpt_${now}`
  const destRoot = checkpointPath(opts.workflowId, id)
  await ensureDir(destRoot)

  const manifest: CheckpointManifest = {
    id,
    workflowId: opts.workflowId,
    note: opts.note,
    createdAt: now,
    proposalId: opts.proposalId,
    taskState: cloneTaskState(opts.taskState),
    workspaceRoot: ROOT_DIR,
    includeWorkspace,
    messageCreatedAt: opts.messageCreatedAt,
  }

  if (!manifest.taskState.checkpoints) {
    manifest.taskState.checkpoints = { count: 0 }
  }
  manifest.taskState.lastCheckpointId = id
  manifest.taskState.checkpoints.lastId = id
  manifest.taskState.checkpoints.lastNote = opts.note
  manifest.taskState.checkpoints.lastCreatedAt = now
  if (typeof opts.messageCreatedAt === 'number') {
    manifest.taskState.checkpoints.lastMessageCreatedAt = opts.messageCreatedAt
  }

  if (includeWorkspace) {
    const files = await collectWorkspaceFiles(ROOT_DIR)
    const { files: fileEntries, zipSize } = await computeZipFromFiles(opts.workflowId, id, files)
    manifest.files = fileEntries
    manifest.zipSize = zipSize
  }

  await writeManifest(destRoot, manifest)
  await clampCheckpoints(opts.workflowId)

  return {
    id,
    workflowId: opts.workflowId,
    note: opts.note,
    createdAt: now,
    proposalId: opts.proposalId,
    messageCreatedAt: opts.messageCreatedAt,
    zipSize: manifest.zipSize,
    path: destRoot,
  }
}

export async function listCheckpoints(workflowId?: string): Promise<CheckpointSummary[]> {
  const baseDir = CHECKPOINT_ROOT
  try {
    const workflows = workflowId ? [workflowId] : await fsp.readdir(baseDir)
    const out: CheckpointSummary[] = []
    for (const wf of workflows) {
      const dir = checkpointDir(wf)
      try {
        const entries = await fsp.readdir(dir)
        for (const entry of entries) {
          const manifest = await readManifest(path.join(dir, entry))
          if (!manifest) continue
          out.push({
            id: manifest.id,
            workflowId: manifest.workflowId,
            note: manifest.note,
            createdAt: manifest.createdAt,
            proposalId: manifest.proposalId,
            messageCreatedAt: manifest.messageCreatedAt,
            zipSize: manifest.zipSize,
            path: path.join(dir, entry),
          })
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          console.warn('[checkpoints] failed to list workflow', wf, err)
        }
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[checkpoints] list failed', err)
    }
    return []
  }
}

export async function loadCheckpoint(checkpointId: string): Promise<CheckpointManifest | undefined> {
  const all = await listCheckpoints()
  const match = all.find((s) => s.id === checkpointId)
  if (!match) return undefined
  return readManifest(checkpointPath(match.workflowId, checkpointId))
}

export async function getCheckpointManifest(workflowId: string, checkpointId: string): Promise<CheckpointManifest | undefined> {
  return readManifest(checkpointPath(workflowId, checkpointId))
}

export async function restoreCheckpoint(opts: {
  checkpointId: string
  mode: 'conversation' | 'workspace' | 'both'
}): Promise<CheckpointManifest | undefined> {
  const manifest = await loadCheckpoint(opts.checkpointId)
  if (!manifest) return undefined

  if (opts.mode === 'conversation' || opts.mode === 'both') {
    replaceTaskState(manifest.workflowId, manifest.taskState)
  }

  if ((opts.mode === 'workspace' || opts.mode === 'both') && manifest.includeWorkspace) {
    const archive = archivePath(manifest.workflowId, manifest.id)
    if (fs.existsSync(archive)) {
      try {
        const zip = new AdmZip(archive)
        zip.extractAllTo(ROOT_DIR, true)
      } catch (err) {
        console.warn('[checkpoints] restore failed while extracting workspace', err)
        throw err
      }
    }
  }

  return manifest
}

export function getArchiveAbsolutePath(workflowId: string, checkpointId: string): string {
  return archivePath(workflowId, checkpointId)
}
