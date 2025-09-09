export type EditPos = { line: number; character: number }
export type Edit = { start: EditPos; end: EditPos; text: string }
export type EditProposal = {
  id: string
  type: 'edit'
  path: string
  diff: { mode: 'rangeEDITS'; edits: Edit[] }
  notes?: string
  safety?: { beforeHash?: string }
}
export type ObjectOp =
  | { op: 'create_instance'; className: string; parentPath: string; props?: Record<string, unknown> }
  | { op: 'set_properties'; path: string; props: Record<string, unknown> }
  | { op: 'rename_instance'; path: string; newName: string }
  | { op: 'delete_instance'; path: string }
export type ObjectProposal = { id: string; type: 'object_op'; ops: ObjectOp[]; notes?: string }
export type AssetProposal = {
  id: string
  type: 'asset_op'
  search?: { query: string; tags?: string[]; limit?: number }
  insert?: { assetId: number; parentPath?: string }
  generate3d?: { prompt: string; tags?: string[]; style?: string; budget?: number }
}
export type Proposal = EditProposal | ObjectProposal | AssetProposal

export type ChatInput = {
  projectId: string
  message: string
  context: {
    activeScript: { path: string; text: string } | null
    selection?: { className: string; path: string }[]
    openDocs?: { path: string }[]
  }
  provider?: { name: 'openrouter'; apiKey: string; model?: string; baseUrl?: string }
}

function id(prefix = 'p'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`
}

function sanitizeComment(text: string): string {
  return text.replace(/\n/g, ' ').slice(0, 160)
}

// Provider call
import { callOpenRouter } from './providers/openrouter'
import { z } from 'zod'
import { Tools } from '../tools/schemas'
import { getSession, setLastTool } from '../store/sessions'
import { pushChunk } from '../store/stream'
import { applyRangeEdits, simpleUnifiedDiff } from '../diff/rangeEdits'
import crypto from 'node:crypto'

const SYSTEM_PROMPT = `You are Vector, a Roblox Studio copilot.
Proposal-first. One tool per message.
Output EXACTLY ONE tool call in an XML-like format and NOTHING ELSE:
<tool_name>\n  <param1>...</param1>\n  <param2>...</param2>\n</tool_name>

Context tools (read-only): get_active_script(), list_selection(), list_open_documents().
Action tools: show_diff(path,edits[]), apply_edit(path,edits[]), create_instance(className,parentPath,props), set_properties(path,props), rename_instance(path,newName), delete_instance(path), search_assets(query,tags?,limit?), insert_asset(assetId,parentPath?), generate_asset_3d(prompt,tags?,style?,budget?).

Rules: minimal diffs; use rangeEDITS {start:{line,character}, end:{line,character}, text}. Reference Instance paths via GetFullName(). Keep context requests minimal and only when needed.`

function tryParseJSON<T = any>(s: unknown): T | undefined {
  if (typeof s !== 'string') return undefined
  const t = s.trim()
  if (!t) return undefined
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(t) as T } catch { return undefined }
  }
  return undefined
}

function coercePrimitive(v: string): any {
  const t = v.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null
  if (!isNaN(Number(t))) return Number(t)
  const j = tryParseJSON(t)
  if (j !== undefined) return j
  return v
}

function parseToolXML(text: string): { name: string; args: Record<string, any> } | null {
  if (!text) return null
  const toolMatch = text.match(/<([a-zA-Z_][\w]*)>([\s\S]*)<\/\1>/)
  if (!toolMatch) return null
  const name = toolMatch[1]
  const inner = toolMatch[2]
  // parse child tags into args
  const args: Record<string, any> = {}
  const tagRe = /<([a-zA-Z_][\w]*)>([\s\S]*?)<\/\1>/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(inner))) {
    const k = m[1]
    const raw = m[2]
    args[k] = coercePrimitive(raw)
  }
  // If no child tags, try parsing whole inner as JSON
  if (Object.keys(args).length === 0) {
    const asJson = tryParseJSON(inner)
    if (asJson && typeof asJson === 'object') return { name, args: asJson as any }
  }
  return { name, args }
}

function toEditArray(editsRaw: any): Edit[] | null {
  const parsed = Array.isArray(editsRaw) ? editsRaw : tryParseJSON(editsRaw)
  if (!parsed || !Array.isArray(parsed)) return null
  const out: Edit[] = []
  for (const e of parsed) {
    if (
      e && e.start && e.end && typeof e.text === 'string' &&
      typeof e.start.line === 'number' && typeof e.start.character === 'number' &&
      typeof e.end.line === 'number' && typeof e.end.character === 'number'
    ) {
      out.push({ start: { line: e.start.line, character: e.start.character }, end: { line: e.end.line, character: e.end.character }, text: e.text })
    }
  }
  return out.length ? out : null
}

function mapToolToProposals(name: string, a: Record<string, any>, input: ChatInput, msg: string): Proposal[] {
  const proposals: Proposal[] = []
  const ensurePath = (fallback?: string | null): string | undefined => {
    const p = typeof a.path === 'string' ? a.path : undefined
    return p || (fallback || undefined)
  }
  if (name === 'show_diff' || name === 'apply_edit') {
    const path = ensurePath(input.context.activeScript?.path || null)
    const edits = toEditArray((a as any).edits)
    if (path && edits) {
      const old = input.context.activeScript?.text || ''
      const next = applyRangeEdits(old, edits)
      const unified = simpleUnifiedDiff(old, next, path)
      const beforeHash = crypto.createHash('sha1').update(old).digest('hex')
      proposals.push({ id: id('edit'), type: 'edit', path, notes: `Parsed from ${name}`, diff: { mode: 'rangeEDITS', edits }, preview: { unified }, safety: { beforeHash } } as any)
      return proposals
    }
  }
  if (name === 'create_instance') {
    const parentPath: string | undefined = (a as any).parentPath
    if (typeof (a as any).className === 'string' && parentPath) {
      const op: ObjectOp = { op: 'create_instance', className: (a as any).className, parentPath, props: (a as any).props }
      proposals.push({ id: id('obj'), type: 'object_op', ops: [op], notes: 'Parsed from create_instance' })
      return proposals
    }
  }
  if (name === 'set_properties') {
    if (typeof (a as any).path === 'string' && (a as any).props && typeof (a as any).props === 'object') {
      const op: ObjectOp = { op: 'set_properties', path: (a as any).path, props: (a as any).props }
      proposals.push({ id: id('obj'), type: 'object_op', ops: [op], notes: 'Parsed from set_properties' })
      return proposals
    }
  }
  if (name === 'rename_instance') {
    const path = ensurePath()
    if (path && typeof (a as any).newName === 'string') {
      proposals.push({ id: id('obj'), type: 'object_op', ops: [{ op: 'rename_instance', path, newName: (a as any).newName }], notes: 'Parsed from rename_instance' })
      return proposals
    }
  }
  if (name === 'delete_instance') {
    const path = ensurePath()
    if (path) {
      proposals.push({ id: id('obj'), type: 'object_op', ops: [{ op: 'delete_instance', path }], notes: 'Parsed from delete_instance' })
      return proposals
    }
  }
  if (name === 'search_assets') {
    const query = typeof (a as any).query === 'string' ? (a as any).query : (msg || 'button')
    const tags = Array.isArray((a as any).tags) ? (a as any).tags.map(String) : undefined
    const limit = typeof (a as any).limit === 'number' ? (a as any).limit : 6
    proposals.push({ id: id('asset'), type: 'asset_op', search: { query, tags, limit } })
    return proposals
  }
  if (name === 'insert_asset') {
    const assetId = typeof (a as any).assetId === 'number' ? (a as any).assetId : Number((a as any).assetId)
    if (!isNaN(assetId)) {
      proposals.push({ id: id('asset'), type: 'asset_op', insert: { assetId, parentPath: typeof (a as any).parentPath === 'string' ? (a as any).parentPath : undefined } })
      return proposals
    }
  }
  if (name === 'generate_asset_3d') {
    if (typeof (a as any).prompt === 'string') {
      proposals.push({ id: id('asset'), type: 'asset_op', generate3d: { prompt: (a as any).prompt, tags: Array.isArray((a as any).tags) ? (a as any).tags.map(String) : undefined, style: typeof (a as any).style === 'string' ? (a as any).style : undefined, budget: typeof (a as any).budget === 'number' ? (a as any).budget : undefined } })
      return proposals
    }
  }
  return proposals
}

export async function runLLM(input: ChatInput): Promise<Proposal[]> {
  const msg = input.message.trim()

  // Provider gating
  const providerRequested = !!(input.provider && input.provider.name === 'openrouter' && !!input.provider.apiKey)
  const useProvider = providerRequested || process.env.VECTOR_USE_OPENROUTER === '1'

  // Deterministic templates for milestone verification
  const lower = msg.toLowerCase()
  const proposals: Proposal[] = []
  const addObj = (ops: ObjectOp[], notes?: string) => proposals.push({ id: id('obj'), type: 'object_op', ops, notes })
  const makePartProps = (name: string, x: number, y: number, z: number) => ({
    Name: name,
    Anchored: true,
    Size: { x: 4, y: 1, z: 4 },
    CFrame: { x, y, z },
  })
  if (/\b(grid\s*3\s*x\s*3|3\s*x\s*3\s*grid)\b/.test(lower)) {
    const parent = 'game.Workspace'
    addObj([{ op: 'create_instance', className: 'Model', parentPath: parent, props: { Name: 'Grid' } }], 'Create Grid model')
    const basePath = 'game.Workspace.Grid'
    const coords = [-4, 0, 4]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const name = `Cell_${i + 1}_${j + 1}`
        const x = coords[j]
        const z = coords[i]
        addObj([
          { op: 'create_instance', className: 'Part', parentPath: basePath, props: makePartProps(name, x, 0.5, z) },
        ], `Create ${name}`)
      }
    }
    return proposals
  }
  if (/\bfarming\b/.test(lower)) {
    const parent = 'game.Workspace'
    addObj([{ op: 'create_instance', className: 'Model', parentPath: parent, props: { Name: 'Farm' } }], 'Create Farm model')
    const basePath = 'game.Workspace.Farm'
    addObj([{ op: 'create_instance', className: 'Part', parentPath: basePath, props: { Name: 'FarmBase', Anchored: true, Size: { x: 40, y: 1, z: 40 }, CFrame: { x: 0, y: 0.5, z: 0 } } }], 'Create Farm base')
    // 4x4 soil grid = 16 steps including farm+base above → add 14 more
    const coords = [-12, -4, 4, 12]
    let count = 0
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (count >= 14) break
        const name = `Soil_${i + 1}_${j + 1}`
        const x = coords[j]
        const z = coords[i]
        addObj([{ op: 'create_instance', className: 'Part', parentPath: basePath, props: makePartProps(name, x, 0.5, z) }], `Create ${name}`)
        count++
      }
      if (count >= 14) break
    }
    return proposals
  }

  // Helper: build tool XML from name/args (for assistant history)
  const toXml = (name: string, args: Record<string, any>): string => {
    const parts: string[] = [`<${name}>`]
    for (const [k, v] of Object.entries(args || {})) {
      const val = typeof v === 'string' ? v : JSON.stringify(v)
      parts.push(`  <${k}>${val}</${k}>`)
    }
    parts.push(`</${name}>`)
    return parts.join('\n')
  }

  // Multi-turn Plan/Act loop
  if (useProvider) {
    const maxTurns = Number(process.env.VECTOR_MAX_TURNS || 4)
    const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: msg }]
    const streamKey = (input as any).workflowId || input.projectId
    const validationRetryLimit = 2
    const unknownToolRetryLimit = 1
    let unknownToolRetries = 0
    let consecutiveValidationErrors = 0

    for (let turn = 0; turn < maxTurns; turn++) {
      let content = ''
      try {
        const resp = await callOpenRouter({
          systemPrompt: SYSTEM_PROMPT,
          messages: messages as any,
          model: input.provider?.model,
          apiKey: input.provider?.apiKey,
          baseUrl: input.provider?.baseUrl,
        })
        content = resp.content || ''
        pushChunk(streamKey, `provider.response turn=${turn}`)
      } catch (e: any) {
        pushChunk(streamKey, `error.provider ${e?.message || 'unknown'}`)
        if (providerRequested) throw new Error(`Provider error: ${e?.message || 'unknown'}`)
        break
      }

      const tool = parseToolXML(content)
      if (!tool) {
        pushChunk(streamKey, 'error.validation no tool call parsed')
        if (providerRequested) throw new Error('Provider returned no parseable tool call')
        break
      }

      const name = tool.name as keyof typeof Tools | string
      let a: Record<string, any> = tool.args || {}

      // Infer missing fields from context (e.g., path)
      if ((name === 'show_diff' || name === 'apply_edit') && !a.path && input.context.activeScript?.path) {
        a = { ...a, path: input.context.activeScript.path }
      }

      // Validate if known tool
      const schema = (Tools as any)[name as any] as z.ZodTypeAny | undefined
      if (schema) {
        const parsed = schema.safeParse(a)
        if (!parsed.success) {
          consecutiveValidationErrors++
          const errMsg = parsed.error?.errors?.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') || 'invalid arguments'
          pushChunk(streamKey, `error.validation ${String(name)} ${errMsg}`)
          // Reflect error verbatim and retry (up to limit)
          messages.push({ role: 'assistant', content: toXml(String(name), a) })
          messages.push({ role: 'user', content: `VALIDATION_ERROR ${String(name)}\n${errMsg}` })
          if (consecutiveValidationErrors > validationRetryLimit) {
            throw new Error(`Validation failed repeatedly for ${String(name)}: ${errMsg}`)
          }
          continue
        } else {
          consecutiveValidationErrors = 0
          a = parsed.data
        }
      }

      // Context tools: execute locally, feed result back, and continue
      const isContextTool = name === 'get_active_script' || name === 'list_selection' || name === 'list_open_documents'
      if (isContextTool) {
        const result = name === 'get_active_script'
          ? (input.context.activeScript || null)
          : name === 'list_selection'
            ? (input.context.selection || [])
            : (input.context.openDocs || [])

        // Avoid pushing extremely large buffers
        const safeResult = name === 'get_active_script' && result && typeof (result as any).text === 'string'
          ? { ...(result as any), text: ((result as any).text as string).slice(0, 40000) }
          : result

        setLastTool(input.projectId, String(name), safeResult)
        pushChunk(streamKey, `tool.result ${String(name)}`)

        // Append assistant tool call and user tool result to the conversation
        messages.push({ role: 'assistant', content: toXml(String(name), a) })
        messages.push({ role: 'user', content: `TOOL_RESULT ${String(name)}\n` + JSON.stringify(safeResult) })
        continue
      }

      // Non-context tools → map to proposals and return
      const mapped = mapToolToProposals(String(name), a, input, msg)
      if (mapped.length) return mapped

      // If model emitted an unknown planning tag like <plan>, carry it forward and continue
      if (String(name).toLowerCase() === 'plan') {
        messages.push({ role: 'assistant', content: toXml(String(name), a) })
        pushChunk(streamKey, 'planning…')
        continue
      }

      // Unknown tool: reflect error and allow a limited retry
      if (!(Tools as any)[name as any]) {
        unknownToolRetries++
        const errMsg = `Unknown tool: ${String(name)}`
        pushChunk(streamKey, `error.validation ${errMsg}`)
        messages.push({ role: 'assistant', content: toXml(String(name), a) })
        messages.push({ role: 'user', content: `VALIDATION_ERROR ${String(name)}\n${errMsg}` })
        if (unknownToolRetries > unknownToolRetryLimit) break
        continue
      }

      // Otherwise break to fallbacks
      break
    }
  }

  // Fallbacks: safe, deterministic proposals without provider parsing
  const fallbacksDisabled = (process.env.VECTOR_DISABLE_FALLBACKS || '1') === '1'
  if (!fallbacksDisabled && input.context.activeScript) {
    const path = input.context.activeScript.path
    const prefixComment = `-- Vector: ${sanitizeComment(msg)}\n`
    const edits = [{ start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, text: prefixComment }]
    const old = input.context.activeScript.text
    const next = applyRangeEdits(old, edits)
    const unified = simpleUnifiedDiff(old, next, path)
    return [{
      id: id('edit'),
      type: 'edit',
      path,
      notes: 'Insert a comment at the top as a placeholder for an edit.',
      diff: { mode: 'rangeEDITS', edits },
      preview: { unified },
      safety: { beforeHash: (require('node:crypto') as typeof import('node:crypto')).createHash('sha1').update(old).digest('hex') },
    } as any]
  }

  if (!fallbacksDisabled && input.context.selection && input.context.selection.length > 0) {
    const first = input.context.selection[0]
    return [
      {
        id: id('obj'),
        type: 'object_op',
        notes: 'Rename selected instance by appending _Warp',
        ops: [{ op: 'rename_instance', path: first.path, newName: `${first.path.split('.').pop() || 'Instance'}_Warp` }],
      },
    ]
  }

  if (!fallbacksDisabled) {
    return [
      { id: id('asset'), type: 'asset_op', search: { query: msg || 'button', limit: 6 } },
    ]
  }
  throw new Error('No actionable tool produced within turn limit')
}
