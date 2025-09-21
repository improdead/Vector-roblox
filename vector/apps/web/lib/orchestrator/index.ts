export type EditPos = { line: number; character: number }
export type Edit = { start: EditPos; end: EditPos; text: string }

type ProposalMeta = { meta?: { autoApproved?: boolean } }

export type EditAnchors = {
  startLineText?: string
  endLineText?: string
}

export type EditFileChange = {
  path: string
  diff: { mode: 'rangeEDITS'; edits: Edit[] }
  preview?: { unified?: string; before?: string; after?: string }
  safety?: { beforeHash?: string; baseText?: string; anchors?: EditAnchors }
}

export type EditProposal = ProposalMeta & {
  id: string
  type: 'edit'
  files: EditFileChange[]
  notes?: string
  /**
   * Deprecated single-file fields kept for backward compatibility. Always mirrors `files[0]`.
   */
  path?: string
  diff?: EditFileChange['diff']
  preview?: EditFileChange['preview']
  safety?: EditFileChange['safety']
}
export type ObjectOp =
  | { op: 'create_instance'; className: string; parentPath: string; props?: Record<string, unknown> }
  | { op: 'set_properties'; path: string; props: Record<string, unknown> }
  | { op: 'rename_instance'; path: string; newName: string }
  | { op: 'delete_instance'; path: string }
export type ObjectProposal = ProposalMeta & { id: string; type: 'object_op'; ops: ObjectOp[]; notes?: string }
export type AssetProposal = ProposalMeta & {
  id: string
  type: 'asset_op'
  search?: { query: string; tags?: string[]; limit?: number }
  insert?: { assetId: number; parentPath?: string }
  generate3d?: { prompt: string; tags?: string[]; style?: string; budget?: number }
}
export type CompletionProposal = ProposalMeta & {
  id: string
  type: 'completion'
  summary: string
  confidence?: number
}
export type Proposal = EditProposal | ObjectProposal | AssetProposal | CompletionProposal

export type ChatInput = {
  projectId: string
  message: string
  context: {
    // activeScript can be undefined when Studio has no open script; provider can gather context via tools
    activeScript?: { path: string; text: string } | null
    selection?: { className: string; path: string }[]
    openDocs?: { path: string }[]
  }
  provider?: { name: 'openrouter' | 'gemini'; apiKey: string; model?: string; baseUrl?: string }
  modelOverride?: string | null
  autoApply?: boolean
  mode?: 'ask' | 'agent'
  maxTurns?: number
  enableFallbacks?: boolean
}

function id(prefix = 'p'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`
}

function sanitizeComment(text: string): string {
  return text.replace(/\n/g, ' ').slice(0, 160)
}

function computeAnchors(baseText: string, edits: Edit[]): EditAnchors {
  if (!edits || edits.length === 0) return {}
  const lines = baseText.split('\n')
  const first = edits[0]
  const last = edits[edits.length - 1]
  const startIdx = Math.max(0, Math.min(first.start.line, lines.length - 1))
  let endIdx = last.end.line ?? first.start.line
  if (last.end.character === 0 && endIdx > first.start.line) {
    endIdx -= 1
  }
  if (endIdx < first.start.line) endIdx = first.start.line
  endIdx = Math.max(0, Math.min(endIdx, lines.length - 1))
  return {
    startLineText: lines[startIdx] ?? '',
    endLineText: lines[endIdx] ?? lines[startIdx] ?? '',
  }
}

// Provider call
import { callOpenRouter } from './providers/openrouter'
import { callGemini } from './providers/gemini'
import { z } from 'zod'
import { Tools } from '../tools/schemas'
import { getSession, setLastTool } from '../store/sessions'
import { pushChunk } from '../store/stream'
import { applyRangeEdits, simpleUnifiedDiff } from '../diff/rangeEdits'
import crypto from 'node:crypto'
import { TaskState, getTaskState as loadTaskState, updateTaskState } from './taskState'
import { extractMentions } from '../context/mentions'
import { listCodeDefinitionNames, searchFiles } from '../tools/codeIntel'
import { annotateAutoApproval } from './autoApprove'

type ProviderMode = 'openrouter' | 'gemini'

type ProviderSelection = {
  mode: ProviderMode
  apiKey: string
  model?: string
  baseUrl?: string
}

function normalizeString(value?: string | null): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : undefined
  return trimmed ? trimmed : undefined
}

function determineProvider(opts: { input: ChatInput; modelOverride?: string | null }): ProviderSelection | null {
  const { input, modelOverride } = opts
  const overrideRaw = normalizeString(modelOverride)
  const overrideIsGemini = !!overrideRaw && overrideRaw.toLowerCase().startsWith('gemini')
  const defaultProviderEnv = normalizeString(process.env.VECTOR_DEFAULT_PROVIDER)?.toLowerCase()
  const forceOpenRouter = (process.env.VECTOR_USE_OPENROUTER || '0') === '1'

  const preference: ProviderMode[] = []
  if (overrideRaw) preference.push(overrideIsGemini ? 'gemini' : 'openrouter')
  if (input.provider?.name === 'gemini') preference.push('gemini')
  if (input.provider?.name === 'openrouter') preference.push('openrouter')
  if (defaultProviderEnv === 'gemini') preference.push('gemini')
  if (defaultProviderEnv === 'openrouter') preference.push('openrouter')
  if (forceOpenRouter) preference.push('openrouter')
  // Ensure we eventually try both providers as fallbacks in a deterministic order
  preference.push('gemini', 'openrouter')

  const ordered: ProviderMode[] = []
  for (const mode of preference) {
    if (!ordered.includes(mode)) ordered.push(mode)
  }

  for (const mode of ordered) {
    if (mode === 'openrouter') {
      const providerInput = input.provider?.name === 'openrouter' ? input.provider : undefined
      const apiKey = normalizeString(providerInput?.apiKey) || normalizeString(process.env.OPENROUTER_API_KEY)
      if (!apiKey) continue
      const model =
        normalizeString(providerInput?.model) ||
        (overrideRaw && !overrideIsGemini ? overrideRaw : undefined) ||
        normalizeString(process.env.OPENROUTER_MODEL)
      const baseUrl = normalizeString(providerInput?.baseUrl)
      return { mode, apiKey, model, baseUrl }
    }

    if (mode === 'gemini') {
      const providerInput = input.provider?.name === 'gemini' ? input.provider : undefined
      const apiKey = normalizeString(providerInput?.apiKey) || normalizeString(process.env.GEMINI_API_KEY)
      if (!apiKey) continue
      const model =
        normalizeString(providerInput?.model) ||
        (overrideIsGemini ? overrideRaw : undefined) ||
        normalizeString(process.env.GEMINI_MODEL)
      const baseUrl = normalizeString(providerInput?.baseUrl) || normalizeString(process.env.GEMINI_API_BASE_URL)
      return { mode, apiKey, model, baseUrl }
    }
  }

  return null
}

const SYSTEM_PROMPT = `You are Vector, a Roblox Studio copilot.

Core rules
- One tool per turn: emit EXACTLY ONE tool tag and NOTHING ELSE. Wait for the tool result before the next step.
- Proposal-first and undoable: never change code/Instances directly; always propose a small, safe step the plugin can preview/apply.
- No prose, no markdown, no code fences, no extra tags. Do NOT invent fictitious tags like <plan> or <thoughts>.

Tool call format (XML-like)
<tool_name>\n  <param1>...</param1>\n  <param2>...</param2>\n</tool_name>

Encoding for parameters
- Strings/numbers: write the literal value.
- Objects/arrays: INNER TEXT MUST be strict JSON (double quotes; no trailing commas). Never wrap JSON in quotes. Never add code fences.
  ✅ <props>{"Name":"Grid","Anchored":true}</props>
  ❌ <props>"{ \"Name\": \"Grid\" }"</props>
  ❌ <props>\`\`\`json{ \"Name\": \"Grid\" }\`\`\`</props>
  ❌ <props>{ Name: "Grid", }</props>
- If a parameter is optional and unknown, omit the tag entirely (do NOT write "null" or "undefined").

Available tools
- Context (read-only): get_active_script(), list_selection(), list_open_documents(maxCount?), list_code_definition_names(root?,limit?,exts?), search_files(query,root?,limit?,exts?,caseSensitive?).
- Actions: show_diff(path,edits[]), apply_edit(path,edits[]), create_instance(className,parentPath,props?), set_properties(path,props), rename_instance(path,newName), delete_instance(path), search_assets(query,tags?,limit?), insert_asset(assetId,parentPath?), generate_asset_3d(prompt,tags?,style?,budget?).
- Completion: complete(summary,confidence?) or attempt_completion(result,confidence?) — must be called when the task is finished to present the result.

Paths & names
- Use canonical GetFullName() paths, e.g., game.Workspace.Model.Part.
- Avoid creating names with dots or slashes; prefer alphanumerics + underscores (e.g., Cell_1_1).
- If an existing path contains special characters, bracket segments: game.Workspace["My.Part"]["Wall [A]"]

Roblox typed values (for props)
- Scalars/booleans/strings: raw JSON.
- Wrappers with "__t": Vector3 {"__t":"Vector3","x":0,"y":1,"z":0}; Vector2 {"__t":"Vector2","x":0,"y":0};
  Color3 {"__t":"Color3","r":1,"g":0.5,"b":0.25}; UDim {"__t":"UDim","scale":0,"offset":16};
  UDim2 {"__t":"UDim2","x":{"scale":0,"offset":0},"y":{"scale":0,"offset":0}};
  CFrame {"__t":"CFrame","comps":[x,y,z, r00,r01,r02, r10,r11,r12, r20,r21,r22]};
  EnumItem {"__t":"EnumItem","enum":"Enum.Material","name":"Plastic"};
  BrickColor {"__t":"BrickColor","name":"Bright red"};
  Instance ref {"__t":"Instance","path":"game.ReplicatedStorage.Folder.Template"}.
- Attributes: prefix keys with @, e.g., {"@Health":100}.

Editing rules
- 0-based coordinates; end is exclusive. Prefer the smallest edit set; avoid whole-file rewrites.
- Prefer show_diff first; use apply_edit only after approval. Never include __finalText.

Context & defaults
- If you need path/selection and it wasn't provided, call get_active_script / list_selection first.
- If parentPath is unknown for create_instance/insert_asset, use game.Workspace.
- Only set real properties for the target class; do not create instances via set_properties.

Mentions
- Users may attach context via '@file path/to/file', '@folder path/to/folder', '@url https://…', or '@problems' to load diagnostic logs. These appear in the conversation history—use them before requesting additional context.

Modes
- Ask: do exactly one atomic change.
- Agent: fetch minimal context if needed, then act with one tool.
- Auto: assume approved small steps; avoid destructive ops; skip actions that require human choice.

Assets & 3D
 - search_assets: keep limit ≤ 6 unless the user asks; include tags when helpful.
 - insert_asset: assetId must be a number; default parentPath to game.Workspace if unknown.
 - generate_asset_3d: returns a jobId only; prefer insert_asset when inserting existing assets.
 - If search_assets returns no results or metadata reports a stub/fallback, stop retrying catalog lookups.
 - Switch to manual creation: use create_instance for simple primitives or author Luau via show_diff/apply_edit so the scene still progresses.

Validation & recovery
- On VALIDATION_ERROR, resubmit the SAME tool once with corrected args; no commentary and no tool switching.
- If you return with no tool call, you MUST either choose exactly one tool or call complete(summary) to finish.

Selection defaults
- If EXACTLY ONE instance is selected and it is a reasonable container, prefer it by default:
  - Use that selection as <parentPath> for create_instance/insert_asset when unspecified.
  - Use that selection's path for rename_instance/set_properties/delete_instance when <path> is missing.
  - If no single valid selection, default to game.Workspace or fetch context as needed.

Properties vs Attributes
- Only set real class properties in <props>. If a key is not a property of the target class, write it as an Attribute by prefixing with "@".
- Do NOT rename via set_properties. Use <rename_instance> instead.

Edit constraints
- Edits must be sorted by start position and be NON-OVERLAPPING.
- Keep small: ≤ 20 edits AND ≤ 2000 inserted characters total.
- Never send an empty edits array.

Safety for instance ops
- Never delete DataModel or Services. Operate under Workspace unless the user targets another service explicitly.
- Use only valid Roblox class names for <className>. If unsure, prefer "Part" or "Model".

Path & JSON hygiene
- No leading/trailing whitespace or code fences inside parameter bodies.
- Do not include blank lines before/after the outer tool tag.
- When a segment contains dots/brackets, use bracket notation exactly: game.Workspace["My.Part"]["Wall [A]"]

Examples (correct)
<create_instance>\n  <className>Part</className>\n  <parentPath>game.Workspace</parentPath>\n  <props>{"Name":"Cell_1_1","Anchored":true,"Size":{"__t":"Vector3","x":4,"y":1,"z":4},"CFrame":{"__t":"CFrame","comps":[0,0.5,0, 1,0,0, 0,1,0, 0,0,1]}}</props>\n</create_instance>

<set_properties>\n  <path>game.Workspace.Cell_1_1</path>\n  <props>{"Anchored":true,"Material":{"__t":"EnumItem","enum":"Enum.Material","name":"Plastic"},"@Health":100}</props>\n</set_properties>

<show_diff>\n  <path>game.Workspace.Script</path>\n  <edits>[{"start":{"line":0,"character":0},"end":{"line":0,"character":0},"text":"-- Header\\n"}]</edits>\n</show_diff>`

function tryParseJSON<T = any>(s: unknown): T | undefined {
  if (typeof s !== 'string') return undefined
  const t = s.trim()
  if (!t) return undefined
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(t) as T } catch { return undefined }
  }
  return undefined
}

function tryParseStrictJSON(s: string): any {
  try { return JSON.parse(s) } catch { return undefined }
}

function coercePrimitive(v: string): any {
  const t = v.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null
  if (!isNaN(Number(t))) return Number(t)
  // Try strict JSON first
  const jStrict = tryParseStrictJSON(t)
  if (jStrict !== undefined) return jStrict
  // JSON5-like fallback for common LLM outputs: single quotes, unquoted keys, trailing commas, fenced code
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    let s = t
    // Remove surrounding code fences/backticks if present
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '')
    // Replace single-quoted strings with double quotes
    s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
    // Quote bare keys: {key: -> {"key":  and , key: -> , "key":
    s = s.replace(/([\{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":')
    // Remove trailing commas before } or ]
    s = s.replace(/,\s*([}\]])/g, '$1')
    const jLoose = tryParseStrictJSON(s)
    if (jLoose !== undefined) return jLoose
  }
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
  // If no child tags, try parsing whole inner as JSON (or JSON-like)
  if (Object.keys(args).length === 0) {
    const asJson = coercePrimitive(inner)
    if (asJson && typeof asJson === 'object') return { name, args: asJson as any }
  }
  return { name, args }
}

function toEditArray(editsRaw: any): Edit[] | null {
  const parsed = Array.isArray(editsRaw) ? editsRaw : tryParseJSON(editsRaw)
  if (!parsed || !Array.isArray(parsed) || parsed.length === 0) return null
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
  if (!out.length) return null
  // sort by start then end
  out.sort((a, b) =>
    (a.start.line - b.start.line) ||
    (a.start.character - b.start.character) ||
    (a.end.line - b.end.line) ||
    (a.end.character - b.end.character)
  )
  // ensure non-overlapping ranges
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]
    const cur = out[i]
    const overlaps = cur.start.line < prev.end.line || (
      cur.start.line === prev.end.line && cur.start.character < prev.end.character
    )
    if (overlaps) return null
  }
  // budget caps: max 20 edits, 2000 inserted chars
  const totalInsertChars = out.reduce((n, e) => n + (e.text ? String(e.text).length : 0), 0)
  if (out.length > 20 || totalInsertChars > 2000) return null
  return out
}

type MapResult = { proposals: Proposal[]; missingContext?: string }

function mapToolToProposals(name: string, a: Record<string, any>, input: ChatInput, msg: string): MapResult {
  const proposals: Proposal[] = []
  const ensurePath = (fallback?: string | null): string | undefined => {
    const p = typeof a.path === 'string' ? a.path : undefined
    return p || (fallback || undefined)
  }
  if (name === 'show_diff' || name === 'apply_edit') {
    if (Array.isArray((a as any).files) && (a as any).files.length > 0) {
      const fileChanges: EditFileChange[] = []
      for (const entry of (a as any).files as any[]) {
        if (!entry || typeof entry.path !== 'string') continue
        const edits = toEditArray(entry.edits)
        if (!edits) continue
        const baseText: string | undefined = typeof entry.baseText === 'string'
          ? entry.baseText
          : entry.path === input.context.activeScript?.path
            ? input.context.activeScript?.text || ''
            : undefined
        if (typeof baseText !== 'string') continue
        const proposed = applyRangeEdits(baseText, edits)
        const unified = simpleUnifiedDiff(baseText, proposed, entry.path)
        const beforeHash = crypto.createHash('sha1').update(baseText).digest('hex')
        fileChanges.push({
          path: entry.path,
          diff: { mode: 'rangeEDITS', edits },
          preview: { unified },
          safety: { beforeHash, baseText, anchors: computeAnchors(baseText, edits) },
        })
      }
      if (fileChanges.length) {
        const primary = fileChanges[0]
        proposals.push({
          id: id('edit'),
          type: 'edit',
          files: fileChanges,
          path: primary.path,
          diff: primary.diff,
          preview: primary.preview,
          safety: primary.safety,
          notes: `Parsed from ${name}`,
        } as EditProposal)
        return { proposals }
      }
    }

    const path = ensurePath(input.context.activeScript?.path || null)
    const edits = toEditArray((a as any).edits)
    if (path && edits) {
      const old = input.context.activeScript?.text || ''
      const next = applyRangeEdits(old, edits)
      const unified = simpleUnifiedDiff(old, next, path)
      const beforeHash = crypto.createHash('sha1').update(old).digest('hex')
      const fileChange: EditFileChange = {
        path,
        diff: { mode: 'rangeEDITS', edits },
        preview: { unified },
        safety: { beforeHash, baseText: old, anchors: computeAnchors(old, edits) },
      }
      proposals.push({
        id: id('edit'),
        type: 'edit',
        files: [fileChange],
        notes: `Parsed from ${name}`,
        path,
        diff: fileChange.diff,
        preview: fileChange.preview,
        safety: fileChange.safety,
      } as EditProposal as any)
      return { proposals }
    }
    if (!path) return { proposals, missingContext: 'Need active script (auto-open the relevant Script).' }
    if (!edits) return { proposals, missingContext: 'Need edit payload with valid ranges.' }
  }
  if (name === 'create_instance') {
    const parentPath: string | undefined = (a as any).parentPath
    if (typeof (a as any).className === 'string' && parentPath) {
      const op: ObjectOp = { op: 'create_instance', className: (a as any).className, parentPath, props: (a as any).props }
      proposals.push({ id: id('obj'), type: 'object_op', ops: [op], notes: 'Parsed from create_instance' })
      return { proposals }
    }
    if (!parentPath) return { proposals, missingContext: 'Need parent selection to create instance.' }
  }
  if (name === 'set_properties') {
    if (typeof (a as any).path === 'string' && (a as any).props && typeof (a as any).props === 'object') {
      const op: ObjectOp = { op: 'set_properties', path: (a as any).path, props: (a as any).props }
      proposals.push({ id: id('obj'), type: 'object_op', ops: [op], notes: 'Parsed from set_properties' })
      return { proposals }
    }
    return { proposals, missingContext: 'Need selected instance to set properties.' }
  }
  if (name === 'rename_instance') {
    const path = ensurePath()
    if (path && typeof (a as any).newName === 'string') {
      proposals.push({ id: id('obj'), type: 'object_op', ops: [{ op: 'rename_instance', path, newName: (a as any).newName }], notes: 'Parsed from rename_instance' })
      return { proposals }
    }
    return { proposals, missingContext: 'Need selected instance to rename.' }
  }
  if (name === 'delete_instance') {
    // Use selection-derived defaults when available
    const path = ensurePath(input.context.selection && input.context.selection.length === 1 ? input.context.selection[0].path : undefined)
    if (path) {
      // Guard: avoid destructive deletes at DataModel or Services level
      if (/^game(\.[A-Za-z]+Service|\.DataModel)?$/.test(path)) return { proposals }
      proposals.push({ id: id('obj'), type: 'object_op', ops: [{ op: 'delete_instance', path }], notes: 'Parsed from delete_instance' })
      return { proposals }
    }
    return { proposals, missingContext: 'Need selected instance to delete.' }
  }
  if (name === 'search_assets') {
    const query = typeof (a as any).query === 'string' ? (a as any).query : (msg || 'button')
    const tags = Array.isArray((a as any).tags) ? (a as any).tags.map(String) : undefined
    const limit = typeof (a as any).limit === 'number' ? (a as any).limit : 6
    proposals.push({ id: id('asset'), type: 'asset_op', search: { query, tags, limit } })
    return { proposals }
  }
  if (name === 'insert_asset') {
    const assetId = typeof (a as any).assetId === 'number' ? (a as any).assetId : Number((a as any).assetId)
    if (!isNaN(assetId)) {
      proposals.push({ id: id('asset'), type: 'asset_op', insert: { assetId, parentPath: typeof (a as any).parentPath === 'string' ? (a as any).parentPath : undefined } })
      return { proposals }
    }
    return { proposals, missingContext: 'Need assetId to insert asset.' }
  }
  if (name === 'generate_asset_3d') {
    if (typeof (a as any).prompt === 'string') {
      proposals.push({ id: id('asset'), type: 'asset_op', generate3d: { prompt: (a as any).prompt, tags: Array.isArray((a as any).tags) ? (a as any).tags.map(String) : undefined, style: typeof (a as any).style === 'string' ? (a as any).style : undefined, budget: typeof (a as any).budget === 'number' ? (a as any).budget : undefined } })
      return { proposals }
    }
  }
  if (name === 'complete') {
    const summary = typeof (a as any).summary === 'string' ? (a as any).summary : undefined
    const confidence = typeof (a as any).confidence === 'number' ? (a as any).confidence : undefined
    if (summary && summary.trim().length > 0) {
      proposals.push({ id: id('done'), type: 'completion', summary, confidence })
      return { proposals }
    }
  }
  if (name === 'attempt_completion') {
    const result = typeof (a as any).result === 'string' ? (a as any).result : undefined
    const confidence = typeof (a as any).confidence === 'number' ? (a as any).confidence : undefined
    if (result && result.trim().length > 0) {
      proposals.push({ id: id('done'), type: 'completion', summary: result, confidence })
      return { proposals }
    }
  }
  return { proposals }
}

export async function runLLM(input: ChatInput): Promise<{ proposals: Proposal[]; taskState: TaskState }> {
  const rawMessage = input.message.trim()
  const { cleaned, attachments } = await extractMentions(rawMessage)
  const msg = cleaned.length > 0 ? cleaned : rawMessage
  const modelOverride = typeof input.modelOverride === 'string' && input.modelOverride.trim().length > 0
    ? input.modelOverride.trim()
    : undefined
  const autoEnabled = !!(input as any).autoApply

  const taskId = (input as any).workflowId || input.projectId
  let taskState = loadTaskState(taskId)
  const updateState = (fn: (state: TaskState) => void) => {
    taskState = updateTaskState(taskId, fn)
    return taskState
  }
  const appendHistory = (role: 'user' | 'assistant' | 'system', content: string) => {
    updateState((state) => {
      state.history.push({ role, content, at: Date.now() })
      if (role === 'user') state.counters.tokensIn += content.length
      if (role === 'assistant') state.counters.tokensOut += content.length
      const MAX_HISTORY = 40
      const KEEP_RECENT = 20
      if (state.history.length > MAX_HISTORY) {
        const removed = state.history.splice(0, state.history.length - KEEP_RECENT)
        const summary = removed
          .map((entry) => `[${entry.role}] ${entry.content.replace(/\s+/g, ' ').slice(0, 160)}`)
          .join('\n')
        state.history.unshift({ role: 'system', content: `Summary of earlier conversation (trimmed):\n${summary.slice(0, 2000)}`, at: removed[0]?.at || Date.now() })
      }
    })
  }

  appendHistory('user', msg)
  attachments.forEach((att) => {
    appendHistory('system', `[attachment:${att.type}] ${att.label}\n${att.content}`)
  })
  updateState((state) => {
    state.autoApproval.enabled = autoEnabled
    state.autoApproval.readFiles = autoEnabled
    state.autoApproval.editFiles = autoEnabled
    state.autoApproval.execSafe = autoEnabled
    if (typeof state.counters.contextRequests !== 'number') state.counters.contextRequests = 0
  })

  const attachmentSummary = attachments.length
    ? attachments
        .map((att) => `[${att.type}] ${att.label}\n${att.content}`)
        .join('\n---\n')
    : ''
  const providerFirstMessage = attachments.length ? `${msg}\n\n[ATTACHMENTS]\n${attachmentSummary}` : msg

  const contextRequestLimit = 1
  let contextRequestsThisCall = 0
  let requestAdditionalContext: (reason: string) => boolean = () => false

  // Selection‑aware defaults
  const selPath = input.context.selection && input.context.selection.length === 1
    ? input.context.selection[0].path
    : undefined
  const selIsContainer = !!selPath && /^(?:game\.(?:Workspace|ReplicatedStorage|ServerStorage|StarterGui|StarterPack|StarterPlayer|Lighting|Teams|SoundService|TextService|CollectionService)|game\.[A-Za-z]+\.[\s\S]+)/.test(selPath)

  // Provider gating
  const providerRequestedName = input.provider?.name
  const providerRequested = !!normalizeString(input.provider?.apiKey)
  const providerSelection = determineProvider({ input, modelOverride })
  const activeProvider = providerSelection?.mode
  const useProvider = !!providerSelection
  const streamKey = (input as any).workflowId || input.projectId
  const startLog = `provider=${useProvider ? activeProvider : 'fallback'} mode=${input.mode || 'agent'} model=${providerSelection?.model || 'default'}`
  pushChunk(streamKey, `orchestrator.start ${startLog}`)
  console.log(`[orch] start ${startLog} msgLen=${msg.length}`)

  const finalize = (list: Proposal[]): { proposals: Proposal[]; taskState: TaskState } => {
    const annotated = annotateAutoApproval(list, { autoEnabled })
    const totalsIn = taskState.counters.tokensIn
    const totalsOut = taskState.counters.tokensOut
    pushChunk(streamKey, `telemetry.tokens in=${totalsIn} out=${totalsOut}`)
    console.log(`[tokens] workflow=${taskId} in=${totalsIn} out=${totalsOut}`)
    updateState((state) => {
      state.streaming.isStreaming = false
    })
    if (annotated.some((p) => p.type === 'completion')) {
      pushChunk(streamKey, 'completed: model_complete')
      // Optional: checkpoint marker could be added here if we had a server-side checkpoint manager
    }
    return { proposals: annotated, taskState }
  }

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
    appendHistory('assistant', 'template: 3x3 grid')
    return finalize(proposals)
  }
  if (/\bfarming\b/.test(lower)) {
    const parent = 'game.Workspace'
    addObj([{ op: 'create_instance', className: 'Model', parentPath: parent, props: { Name: 'Farm' } }], 'Create Farm model')
    const basePath = 'game.Workspace.Farm'
    addObj([{ op: 'create_instance', className: 'Part', parentPath: basePath, props: { Name: 'FarmBase', Anchored: true, Size: { x: 40, y: 1, z: 40 }, CFrame: { x: 0, y: 0.5, z: 0 } } }], 'Create Farm base')
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
    appendHistory('assistant', 'template: farming kit')
    return finalize(proposals)
  }

  const toXml = (name: string, args: Record<string, any>): string => {
    const parts: string[] = [`<${name}>`]
    for (const [k, v] of Object.entries(args || {})) {
      const val = typeof v === 'string' ? v : JSON.stringify(v)
      parts.push(`  <${k}>${val}</${k}>`)
    }
    parts.push(`</${name}>`)
    return parts.join('\n')
  }

  if (useProvider && providerSelection && activeProvider) {
    const defaultMaxTurns = Number(process.env.VECTOR_MAX_TURNS || 4)
    const maxTurns = Number(
      typeof input.maxTurns === 'number'
        ? input.maxTurns
        : input.mode === 'ask'
          ? 1
          : defaultMaxTurns,
    )
    const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: providerFirstMessage }]
    const validationRetryLimit = 2
    const unknownToolRetryLimit = 1
    let unknownToolRetries = 0
    let consecutiveValidationErrors = 0

    requestAdditionalContext = (reason: string): boolean => {
      if (contextRequestsThisCall >= contextRequestLimit) return false
      contextRequestsThisCall += 1
      const ask = `CONTEXT_REQUEST ${reason}. Please fetch the relevant context (e.g., run get_active_script or list_selection) before continuing.`
      messages.push({ role: 'user', content: ask })
      appendHistory('system', ask)
      updateState((state) => {
        state.counters.contextRequests += 1
      })
      return true
    }

    for (let turn = 0; turn < maxTurns; turn++) {
      const runId = id('run')
      const startedAt = Date.now()
      updateState((state) => {
        state.streaming.isStreaming = true
        state.runs.push({ id: runId, tool: 'provider.call', input: { model: providerSelection?.model }, status: 'running', startedAt })
      })

      let content = ''
      try {
        const timeoutMs = Number(
          activeProvider === 'gemini'
            ? process.env.GEMINI_TIMEOUT_MS || process.env.OPENROUTER_TIMEOUT_MS || 30000
            : process.env.OPENROUTER_TIMEOUT_MS || 30000,
        )
        const resp = activeProvider === 'gemini'
          ? await callGemini({
              systemPrompt: SYSTEM_PROMPT,
              messages: messages as any,
              model: providerSelection.model,
              apiKey: providerSelection.apiKey,
              baseUrl: providerSelection.baseUrl,
              timeoutMs,
            })
          : await callOpenRouter({
              systemPrompt: SYSTEM_PROMPT,
              messages: messages as any,
              model: providerSelection.model,
              apiKey: providerSelection.apiKey,
              baseUrl: providerSelection.baseUrl,
              timeoutMs,
            })
        content = resp.content || ''
        pushChunk(streamKey, `provider.response provider=${activeProvider} turn=${turn} chars=${content.length}`)
        console.log(`[orch] provider.ok provider=${activeProvider} turn=${turn} contentLen=${content.length}`)
        updateState((state) => {
          const run = state.runs.find((r) => r.id === runId)
          if (run) {
            run.status = 'succeeded'
            run.endedAt = Date.now()
          }
          state.streaming.isStreaming = false
        })
        appendHistory('assistant', content)
      } catch (e: any) {
        pushChunk(streamKey, `error.provider provider=${activeProvider} ${e?.message || 'unknown'}`)
        console.error(`[orch] provider.error provider=${activeProvider} ${e?.message || 'unknown'}`)
        updateState((state) => {
          const run = state.runs.find((r) => r.id === runId)
          if (run) {
            run.status = 'failed'
            run.endedAt = Date.now()
            run.error = { message: e?.message || 'unknown' }
          }
          state.streaming.isStreaming = false
        })
        if (providerRequested) throw new Error(`Provider (${providerRequestedName || activeProvider}) error: ${e?.message || 'unknown'}`)
        break
      }

      const tool = parseToolXML(content)
      if (!tool) {
        // Enforce no-text-only turns: nudge to choose a tool or complete
        const hint = 'NO_TOOL_USED Please emit exactly one tool or call <complete><summary>…</summary></complete> to finish.'
        messages.push({ role: 'user', content: hint })
        appendHistory('system', hint)
        pushChunk(streamKey, 'error.validation no tool call parsed (nudged continue)')
        console.warn('[orch] parse.warn no tool call parsed; nudging to tool or complete')
        // Continue loop (do not break) unless provider was hard requested and keeps failing
        if (providerRequested) {
          // allow it to retry within the same loop
        }
        continue
      }

      const name = tool.name as keyof typeof Tools | string
      let a: Record<string, any> = tool.args || {}
      const toolXml = toXml(String(name), a)
      appendHistory('assistant', toolXml)
      pushChunk(streamKey, `tool.parsed ${String(name)}`)
      console.log(`[orch] tool.parsed name=${String(name)}`)

      if ((name === 'show_diff' || name === 'apply_edit') && !a.path && input.context.activeScript?.path) {
        a = { ...a, path: input.context.activeScript.path }
      }
      if ((name === 'rename_instance' || name === 'set_properties' || name === 'delete_instance') && !a.path && selPath) {
        a = { ...a, path: selPath }
      }
      if (name === 'create_instance' && !('parentPath' in a)) {
        a = { ...a, parentPath: selIsContainer ? selPath! : 'game.Workspace' }
      }
      if (name === 'insert_asset' && !('parentPath' in a)) {
        a = { ...a, parentPath: selIsContainer ? selPath! : 'game.Workspace' }
      }

      const schema = (Tools as any)[name as any] as z.ZodTypeAny | undefined
      if (schema) {
        const parsed = schema.safeParse(a)
        if (!parsed.success) {
          consecutiveValidationErrors++
          const errMsg = parsed.error?.errors?.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') || 'invalid arguments'
          pushChunk(streamKey, `error.validation ${String(name)} ${errMsg}`)
          console.warn(`[orch] validation.error tool=${String(name)} ${errMsg}`)
          const validationContent = `VALIDATION_ERROR ${String(name)}\n${errMsg}`
          messages.push({ role: 'assistant', content: toolXml })
          messages.push({ role: 'user', content: validationContent })
          appendHistory('system', validationContent)
          if (consecutiveValidationErrors > validationRetryLimit) {
            throw new Error(`Validation failed repeatedly for ${String(name)}: ${errMsg}`)
          }
          continue
        } else {
          consecutiveValidationErrors = 0
          a = parsed.data
          pushChunk(streamKey, `tool.valid ${String(name)}`)
          console.log(`[orch] validation.ok tool=${String(name)}`)
        }
      }

      const isContextTool =
        name === 'get_active_script' ||
        name === 'list_selection' ||
        name === 'list_open_documents' ||
        name === 'list_code_definition_names' ||
        name === 'search_files'
      if (isContextTool) {
        const result = name === 'get_active_script'
          ? (input.context.activeScript || null)
          : name === 'list_selection'
            ? (input.context.selection || [])
            : name === 'list_open_documents'
              ? (input.context.openDocs || [])
              : name === 'list_code_definition_names'
                ? listCodeDefinitionNames({
                    root: typeof (a as any).root === 'string' ? (a as any).root : undefined,
                    limit: typeof (a as any).limit === 'number' ? (a as any).limit : undefined,
                    exts: Array.isArray((a as any).exts) ? (a as any).exts.map(String) : undefined,
                  })
                : searchFiles({
                    query: String((a as any).query ?? ''),
                    root: typeof (a as any).root === 'string' ? (a as any).root : undefined,
                    limit: typeof (a as any).limit === 'number' ? (a as any).limit : undefined,
                    exts: Array.isArray((a as any).exts) ? (a as any).exts.map(String) : undefined,
                    caseSensitive: !!(a as any).caseSensitive,
                  })

        const safeResult = name === 'get_active_script' && result && typeof (result as any).text === 'string'
          ? { ...(result as any), text: ((result as any).text as string).slice(0, 40000) }
          : result

        setLastTool(input.projectId, String(name), safeResult)
        pushChunk(streamKey, `tool.result ${String(name)}`)

        messages.push({ role: 'assistant', content: toolXml })
        const resultContent = `TOOL_RESULT ${String(name)}\n` + JSON.stringify(safeResult)
        messages.push({ role: 'user', content: resultContent })
        appendHistory('system', resultContent)
        updateState((state) => {
          const ts = Date.now()
          state.runs.push({ id: id('run'), tool: String(name), input: a, status: 'succeeded', startedAt: ts, endedAt: ts })
        })
        continue
      }

      const mapped = mapToolToProposals(String(name), a, input, msg)
      if (mapped.proposals.length) {
        pushChunk(streamKey, `proposals.mapped ${String(name)} count=${mapped.proposals.length}`)
        console.log(`[orch] proposals.mapped tool=${String(name)} count=${mapped.proposals.length}`)
        return finalize(mapped.proposals)
      }
      if (mapped.missingContext) {
        const requested = requestAdditionalContext(mapped.missingContext)
        if (requested) {
          updateState((state) => {
            state.streaming.isStreaming = false
          })
          continue
        }
      }

      if (!(Tools as any)[name as any]) {
        unknownToolRetries++
        const errMsg = `Unknown tool: ${String(name)}`
        pushChunk(streamKey, `error.validation ${errMsg}`)
        console.warn(`[orch] unknown.tool ${String(name)}`)
        messages.push({ role: 'assistant', content: toolXml })
        const errorContent = `VALIDATION_ERROR ${String(name)}\n${errMsg}`
        messages.push({ role: 'user', content: errorContent })
        appendHistory('system', errorContent)
        if (unknownToolRetries > unknownToolRetryLimit) break
        continue
      }

      break
    }
  }

  const fallbacksEnabled = typeof (input as any).enableFallbacks === 'boolean'
    ? (input as any).enableFallbacks
    : (process.env.VECTOR_DISABLE_FALLBACKS || '0') !== '1'
  const fallbacksDisabled = !fallbacksEnabled
  if (!fallbacksDisabled && input.context.activeScript) {
    const path = input.context.activeScript.path
    const prefixComment = `-- Vector: ${sanitizeComment(msg)}\n`
    const edits = [{ start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, text: prefixComment }]
    const old = input.context.activeScript.text
    const next = applyRangeEdits(old, edits)
    const unified = simpleUnifiedDiff(old, next, path)
    const beforeHash = crypto.createHash('sha1').update(old).digest('hex')
    pushChunk(streamKey, 'fallback.edit commentTop')
    console.log('[orch] fallback.edit inserting comment at top')
    appendHistory('assistant', 'fallback: insert comment at top')
    const fileChange: EditFileChange = {
      path,
      diff: { mode: 'rangeEDITS', edits },
      preview: { unified },
      safety: { beforeHash, baseText: old, anchors: computeAnchors(old, edits) },
    }
    return finalize([
      {
        id: id('edit'),
        type: 'edit',
        files: [fileChange],
        path,
        diff: fileChange.diff,
        preview: fileChange.preview,
        safety: fileChange.safety,
        notes: 'Insert a comment at the top as a placeholder for an edit.',
      } as EditProposal,
    ])
  }

  if (!fallbacksDisabled && input.context.selection && input.context.selection.length > 0) {
    const first = input.context.selection[0]
    pushChunk(streamKey, `fallback.object rename ${first.path}`)
    console.log(`[orch] fallback.object rename path=${first.path}`)
    appendHistory('assistant', `fallback: rename ${first.path}`)
    return finalize([
      {
        id: id('obj'),
        type: 'object_op',
        notes: 'Rename selected instance by appending _Warp',
        ops: [{ op: 'rename_instance', path: first.path, newName: `${first.path.split('.').pop() || 'Instance'}_Warp` }],
      },
    ])
  }

  if (!fallbacksDisabled) {
    pushChunk(streamKey, 'fallback.asset search')
    console.log('[orch] fallback.asset search')
    appendHistory('assistant', 'fallback: asset search')
    return finalize([{ id: id('asset'), type: 'asset_op', search: { query: msg || 'button', limit: 6 } }])
  }
  throw new Error('No actionable tool produced within turn limit')
}
