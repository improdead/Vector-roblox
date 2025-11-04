import type { TaskState, SceneGraph, SceneNode } from './taskState'

type ClassWhitelist = Record<string, boolean>

type CreateInstanceInput = {
  className: string
  parentPath: string
  path?: string
  props?: Record<string, unknown>
}

type SetPropertiesInput = {
  path: string
  props: Record<string, unknown>
}

type RenameInstanceInput = {
  path: string
  newName: string
}

type DeleteInstanceInput = {
  path: string
}

type ListChildrenInput = {
  parentPath: string
  depth?: number
  maxNodes?: number
  classWhitelist?: ClassWhitelist | null
}

type GetPropertiesInput = {
  path: string
  keys?: string[] | null
}

function ensureScene(state: TaskState): SceneGraph {
  if (!state.scene || typeof state.scene !== 'object') {
    state.scene = { nodes: {} }
  }
  if (typeof state.scene.nodes !== 'object') {
    state.scene.nodes = {}
  }
  return state.scene
}

const SERVICE_HEADS = new Set([
  'Workspace',
  'ReplicatedStorage',
  'ServerStorage',
  'StarterGui',
  'StarterPack',
  'StarterPlayer',
  'Lighting',
  'Teams',
  'SoundService',
  'TextService',
  'CollectionService',
])

export function normalizeInstancePath(path?: string): string | undefined {
  if (typeof path !== 'string') return undefined
  let trimmed = path.trim()
  if (!trimmed) return undefined
  // Canonicalize service heads to include 'game.' prefix for consistency
  // Examples: 'Workspace', 'Workspace.Hospital' -> 'game.Workspace', 'game.Workspace.Hospital'
  const startsWithGame = trimmed.startsWith('game.')
  const head = trimmed.split('.')[0]
  if (!startsWithGame && SERVICE_HEADS.has(head)) {
    trimmed = `game.${trimmed}`
  }
  return trimmed
}

type SnapshotNode = { path: string; className: string; name: string; parentPath?: string; props?: Record<string, unknown> }

export function hydrateSceneSnapshot(state: TaskState, snapshot?: { nodes?: SnapshotNode[] }) {
  if (!snapshot || !Array.isArray(snapshot.nodes)) return
  const scene = ensureScene(state)
  scene.nodes = {}
  for (const entry of snapshot.nodes) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.className !== 'string') continue
    const path = normalizeInstancePath(entry.path)
    if (!path) continue
    const { parentPath, name } = splitInstancePath(path)
    const nodeName = typeof entry.name === 'string' ? entry.name : name
    const propsClone = cloneProps(entry.props)
    propsClone.Name = propsClone.Name ?? nodeName
    const node: SceneNode = {
      path,
      parentPath: normalizeInstancePath(entry.parentPath) || parentPath,
      name: nodeName,
      className: entry.className,
      props: propsClone,
    }
    scene.nodes[path] = node
  }
}

export function needsBracketedName(name: string): boolean {
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

export function escapeInstanceName(name: string): string {
  return name.replace(/"/g, '\\"')
}

export function buildInstancePath(parentPath: string | undefined, name: string): string {
  const parent = normalizeInstancePath(parentPath) || 'game.Workspace'
  const segment = needsBracketedName(name) ? `["${escapeInstanceName(name)}"]` : name
  return parent ? `${parent}.${segment}` : segment
}

export function splitInstancePath(path: string): { parentPath?: string; name: string } {
  const normalized = normalizeInstancePath(path)
  if (!normalized) return { name: '' }
  let bracketDepth = 0
  let lastDot = -1
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === '[') bracketDepth++
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    else if (ch === '.' && bracketDepth === 0) lastDot = i
  }
  let parentPath: string | undefined
  let nameSegment = normalized
  if (lastDot >= 0) {
    parentPath = normalized.slice(0, lastDot)
    nameSegment = normalized.slice(lastDot + 1)
  }
  let name = nameSegment.trim()
  if (name.startsWith('[') && name.endsWith(']')) {
    name = name.slice(1, -1).trim()
  }
  if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
    name = name.slice(1, -1)
  }
  return { parentPath, name }
}

function cloneProps(props?: Record<string, unknown>): Record<string, unknown> {
  if (!props) return {}
  try {
    return JSON.parse(JSON.stringify(props))
  } catch {
    const clone: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(props)) {
      clone[key] = value
    }
    return clone
  }
}

function getOrCreateNode(scene: SceneGraph, path: string): SceneNode {
  const existing = scene.nodes[path]
  if (existing) return existing
  const { parentPath, name } = splitInstancePath(path)
  const node: SceneNode = {
    path,
    parentPath,
    name,
    className: 'Instance',
    props: {},
  }
  scene.nodes[path] = node
  return node
}

export function recordCreateInstance(state: TaskState, input: CreateInstanceInput) {
  const scene = ensureScene(state)
  const nameFromProps = typeof input.props?.Name === 'string' ? String(input.props?.Name) : input.className
  const path = normalizeInstancePath(input.path) || buildInstancePath(input.parentPath, nameFromProps)
  const { parentPath, name } = splitInstancePath(path)
  const propsClone = cloneProps(input.props)
  propsClone.Name = propsClone.Name ?? name
  const existing = scene.nodes[path]
  const mergedProps = existing ? { ...existing.props, ...propsClone } : propsClone
  const node: SceneNode = {
    path,
    parentPath,
    name,
    className: input.className,
    props: mergedProps,
  }
  scene.nodes[path] = node
}

export function recordSetProperties(state: TaskState, input: SetPropertiesInput) {
  const scene = ensureScene(state)
  const path = normalizeInstancePath(input.path)
  if (!path) return
  const node = getOrCreateNode(scene, path)
  const propsClone = cloneProps(input.props)
  if (typeof propsClone.Name === 'string') {
    node.name = String(propsClone.Name)
  }
  node.props = { ...node.props, ...propsClone }
  scene.nodes[path] = node
}

export function recordDeleteInstance(state: TaskState, input: DeleteInstanceInput) {
  const scene = ensureScene(state)
  const path = normalizeInstancePath(input.path)
  if (!path) return
  const prefix = `${path}.`
  for (const key of Object.keys(scene.nodes)) {
    if (key === path || key.startsWith(prefix)) {
      delete scene.nodes[key]
    }
  }
}

export function recordRenameInstance(state: TaskState, input: RenameInstanceInput) {
  const scene = ensureScene(state)
  const path = normalizeInstancePath(input.path)
  if (!path) return
  const { parentPath } = splitInstancePath(path)
  const newPath = buildInstancePath(parentPath, input.newName)
  const prefix = `${path}.`
  const newPrefix = `${newPath}.`
  const updates: Record<string, SceneNode> = {}
  for (const [key, node] of Object.entries(scene.nodes)) {
    if (key === path || key.startsWith(prefix)) {
      const suffix = key === path ? '' : key.slice(prefix.length)
      const updatedPath = suffix ? `${newPrefix}${suffix}` : newPath
      const updatedParent = node.parentPath
      let nextParent = updatedParent
      if (updatedParent === path) {
        nextParent = newPath
      } else if (updatedParent && updatedParent.startsWith(prefix)) {
        nextParent = newPrefix + updatedParent.slice(prefix.length)
      }
      const updatedNode: SceneNode = {
        ...node,
        path: updatedPath,
        parentPath: nextParent,
        name: suffix ? node.name : input.newName,
        props: { ...node.props },
      }
      if (!suffix) {
        updatedNode.props.Name = input.newName
      }
      updates[key] = updatedNode
    }
  }
  for (const oldPath of Object.keys(updates)) {
    delete scene.nodes[oldPath]
    const node = updates[oldPath]
    scene.nodes[node.path] = node
  }
}

export function listSceneChildren(state: TaskState, input: ListChildrenInput): Array<{ className: string; name: string; path: string }> {
  const parentPath = normalizeInstancePath(input.parentPath)
  if (!parentPath) return []
  const scene = state.scene
  if (!scene || typeof scene.nodes !== 'object') return []
  const depthLimit = typeof input.depth === 'number' ? Math.max(0, Math.min(10, input.depth)) : 1
  if (depthLimit <= 0) return []
  const maxNodes = typeof input.maxNodes === 'number' ? Math.max(1, Math.min(2000, input.maxNodes)) : 200
  const whitelist = input.classWhitelist && typeof input.classWhitelist === 'object' ? input.classWhitelist : undefined

  const results: Array<{ className: string; name: string; path: string }> = []
  const queue: Array<{ path: string; depth: number }> = [{ path: parentPath, depth: 0 }]

  const nodesArray = Object.values(scene.nodes)

  while (queue.length > 0 && results.length < maxNodes) {
    const current = queue.shift()!
    const nextDepth = current.depth + 1
    if (nextDepth > depthLimit) continue
    const children = nodesArray
      .filter((node) => node.parentPath === current.path)
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const child of children) {
      if (!whitelist || whitelist[child.className]) {
        results.push({ className: child.className, name: child.name, path: child.path })
        if (results.length >= maxNodes) break
      }
      if (nextDepth < depthLimit) {
        queue.push({ path: child.path, depth: nextDepth })
      }
    }
  }

  return results
}

export function getSceneProperties(state: TaskState, input: GetPropertiesInput, includeAllAttributes = false): Record<string, unknown> {
  const path = normalizeInstancePath(input.path)
  if (!path) return {}
  const scene = state.scene
  if (!scene || typeof scene.nodes !== 'object') return {}
  const node = scene.nodes[path]
  if (!node) return {}
  const source = node.props || {}
  if (!input.keys || input.keys.length === 0) {
    return cloneProps(source)
  }
  const out: Record<string, unknown> = {}
  for (const key of input.keys) {
    if (key === '@attributes') {
      if (includeAllAttributes) {
        const attrs: Record<string, unknown> = {}
        for (const [attrKey, value] of Object.entries(source)) {
          if (attrKey.startsWith('@')) {
            attrs[attrKey.slice(1)] = value
          }
        }
        out['@attributes'] = cloneProps(attrs)
      }
      continue
    }
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = source[key]
    }
  }
  return out
}

export function applyObjectOpsPreview(state: TaskState, ops: any[]) {
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue
    if (op.op === 'create_instance' && typeof op.className === 'string' && typeof op.parentPath === 'string') {
      recordCreateInstance(state, {
        className: op.className,
        parentPath: String(op.parentPath),
        path: typeof op.path === 'string' ? op.path : undefined,
        props: op.props && typeof op.props === 'object' ? (op.props as Record<string, unknown>) : undefined,
      })
    } else if (op.op === 'set_properties' && typeof op.path === 'string' && op.props) {
      recordSetProperties(state, { path: String(op.path), props: op.props as Record<string, unknown> })
    } else if (op.op === 'rename_instance' && typeof op.path === 'string' && typeof op.newName === 'string') {
      recordRenameInstance(state, { path: String(op.path), newName: String(op.newName) })
    } else if (op.op === 'delete_instance' && typeof op.path === 'string') {
      recordDeleteInstance(state, { path: String(op.path) })
    }
  }
}

export function applyObjectOpResult(state: TaskState, body: any) {
  if (!body || typeof body !== 'object') return
  const op = typeof body.op === 'string' ? body.op : undefined
  if (!op) return
  if (op === 'create_instance' && typeof body.className === 'string' && typeof body.parentPath === 'string') {
    recordCreateInstance(state, {
      className: body.className,
      parentPath: body.parentPath,
      path: typeof body.path === 'string' ? body.path : undefined,
      props: body.props && typeof body.props === 'object' ? (body.props as Record<string, unknown>) : undefined,
    })
  } else if (op === 'set_properties' && typeof body.path === 'string' && body.props) {
    recordSetProperties(state, {
      path: body.path,
      props: body.props as Record<string, unknown>,
    })
  } else if (op === 'rename_instance' && typeof body.path === 'string' && typeof body.newName === 'string') {
    recordRenameInstance(state, {
      path: body.path,
      newName: body.newName,
    })
  } else if (op === 'delete_instance' && typeof body.path === 'string') {
    recordDeleteInstance(state, { path: body.path })
  }
}
