export type EditPos = { line: number; character: number }
export type Edit = { start: EditPos; end: EditPos; text: string }
export type EditProposal = {
  id: string
  type: 'edit'
  path: string
  diff: { mode: 'rangeEDITS'; edits: Edit[] }
  notes?: string
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
import { applyRangeEdits, simpleUnifiedDiff } from '../diff/rangeEdits'

const SYSTEM_PROMPT = `You are Vector, a Roblox Studio copilot.
Proposal-first. One tool per message.
Output EXACTLY ONE tool call in an XML-like format and NOTHING ELSE:
<tool_name>\n  <param1>...</param1>\n  <param2>...</param2>\n</tool_name>
Tools: show_diff(path,edits[]), apply_edit(path,edits[]), create_instance(className,parentPath,props), set_properties(path,props), rename_instance(path,newName), delete_instance(path), search_assets(query,tags?,limit?), insert_asset(assetId,parentPath?), generate_asset_3d(prompt,tags?,style?,budget?)
Rules: minimal diffs; use rangeEDITS {start:{line,character}, end:{line,character}, text}. Reference Paths via Instance:GetFullName()`

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
      proposals.push({ id: id('edit'), type: 'edit', path, notes: `Parsed from ${name}`, diff: { mode: 'rangeEDITS', edits }, preview: { unified } } as any)
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
  const proposals: Proposal[] = []
  const msg = input.message.trim()

  let providerContent: string | undefined
  const providerRequested = !!(input.provider && input.provider.name === 'openrouter' && !!input.provider.apiKey)
  const useProvider = providerRequested || process.env.VECTOR_USE_OPENROUTER === '1'
  if (useProvider) {
    try {
      const resp = await callOpenRouter({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: msg }],
        model: input.provider?.model,
        apiKey: input.provider?.apiKey,
        baseUrl: input.provider?.baseUrl,
      })
      providerContent = resp.content || ''
    } catch (e: any) {
      if (providerRequested) {
        throw new Error(`Provider error: ${e?.message || 'unknown'}`)
      }
      providerContent = undefined
    }
  }

  // If provider returned a tool-call, parse and map to proposals
  const tool = providerContent ? parseToolXML(providerContent) : null
  if (providerRequested && !tool) {
    throw new Error('Provider returned no parseable tool call')
  }
  if (tool) {
    const name = tool.name as keyof typeof Tools
    let a: Record<string, any> = tool.args || {}

    const ensurePath = (fallback?: string | null): string | undefined => {
      const p = typeof a.path === 'string' ? a.path : undefined
      return p || (fallback || undefined)
    }

    // Fill inferred fields from context before validation (e.g., path)
    if ((name === 'show_diff' || name === 'apply_edit') && !a.path && input.context.activeScript?.path) {
      a = { ...a, path: input.context.activeScript.path }
    }

    // zod validation (stricter)
    const schema = (Tools as any)[name] as z.ZodTypeAny | undefined
    if (schema) {
      const parsed = schema.safeParse(a)
      if (!parsed.success) {
        // invalid args -> fall back
      } else {
        a = parsed.data
      }
    }

    // Plan/Act: handle context tools by executing locally and making a second provider call
    const isContextTool = name === 'get_active_script' || name === 'list_selection' || name === 'list_open_documents'
    if (isContextTool && process.env.VECTOR_PLAN_ACT === '1' && process.env.VECTOR_USE_OPENROUTER === '1') {
      const result = name === 'get_active_script'
        ? (input.context.activeScript || null)
        : name === 'list_selection'
          ? (input.context.selection || [])
          : (input.context.openDocs || [])

      setLastTool(input.projectId, name, result)

      // Second call with tool result appended to prompt
      try {
        const followup = await callOpenRouter({
          systemPrompt: SYSTEM_PROMPT + `\nPrevious tool result for ${name}:` + `\n` + JSON.stringify(result).slice(0, 4000),
          messages: [{ role: 'user', content: msg }],
        })
        const t2 = followup.content ? parseToolXML(followup.content) : null
        if (t2) {
          const name2 = t2.name as keyof typeof Tools
          let a2: Record<string, any> = t2.args || {}
          if ((name2 === 'show_diff' || name2 === 'apply_edit') && !a2.path && input.context.activeScript?.path) {
            a2 = { ...a2, path: input.context.activeScript.path }
          }
          const schema2 = (Tools as any)[name2] as z.ZodTypeAny | undefined
          if (schema2) {
            const parsed2 = schema2.safeParse(a2)
            if (parsed2.success) a2 = parsed2.data
          }
          // Map name2 -> proposals below by reusing mapping
          return mapToolToProposals(name2 as string, a2, input, msg)
        }
      } catch {}
      // If followup fails, fall through to fallback generation
    }

    return mapToolToProposals(name as string, a, input, msg)
  }

  // Fallbacks: safe, deterministic proposals without provider parsing
  if (input.context.activeScript) {
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
      notes: providerContent ? 'Provider response did not include a valid tool call; generated fallback edit.' : 'Insert a comment at the top as a placeholder for an edit.',
      diff: { mode: 'rangeEDITS', edits },
      preview: { unified },
    } as any]
  }

  if (input.context.selection && input.context.selection.length > 0) {
    const first = input.context.selection[0]
    return [
      {
        id: id('obj'),
        type: 'object_op',
        notes: providerContent ? 'Provider response did not include a valid tool call; generated fallback rename.' : 'Rename selected instance by appending _Warp',
        ops: [{ op: 'rename_instance', path: first.path, newName: `${first.path.split('.').pop() || 'Instance'}_Warp` }],
      },
    ]
  }

  return [
    { id: id('asset'), type: 'asset_op', search: { query: msg || 'button', limit: 6 } },
  ]
}
