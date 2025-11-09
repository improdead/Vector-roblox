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
    scene?: { nodes?: { path: string; className: string; name: string; parentPath?: string; props?: Record<string, unknown> }[] }
    codeDefinitions?: { file: string; line: number; name: string }[]
  }
  provider?: {
    name: 'openai' | 'openrouter' | 'gemini' | 'bedrock' | 'nvidia'
    apiKey: string
    model?: string
    baseUrl?: string
    region?: string
    deploymentId?: string
  }
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
import { callOpenAI } from './providers/openai'
import { callOpenRouter } from './providers/openrouter'
import { callGemini } from './providers/gemini'
import { callBedrock } from './providers/bedrock'
import { callNvidia } from './providers/nvidia'
import { z } from 'zod'
import { Tools } from '../tools/schemas'
import { setLastTool } from '../store/sessions'
import { pushChunk } from '../store/stream'
import { applyRangeEdits, simpleUnifiedDiff } from '../diff/rangeEdits'
import crypto from 'node:crypto'
import { ScriptPolicyState, TaskState, getTaskState as loadTaskState, updateTaskState } from './taskState'
import { extractMentions } from '../context/mentions'
import { listCodeDefinitionNames, searchFiles, setCodeDefinitionCache } from '../tools/codeIntel'
import type { DefinitionInfo } from '../tools/codeIntel'
import { annotateAutoApproval } from './autoApprove'
import {
  PLANNER_GUIDE,
  QUALITY_CHECK_GUIDE,
  COMPLEXITY_DECISION_GUIDE,
  TOOL_REFERENCE,
  ROLE_SCOPE_GUIDE,
  EXAMPLES_POLICY,
} from './prompts/examples'
import {
  buildInstancePath,
  splitInstancePath,
  listSceneChildren,
  getSceneProperties,
  applyObjectOpsPreview,
  hydrateSceneSnapshot,
} from './sceneGraph'

type ProviderMode = 'openai' | 'openrouter' | 'gemini' | 'bedrock' | 'nvidia'

type ProviderSelection = {
  mode: ProviderMode
  apiKey: string
  model?: string
  baseUrl?: string
  region?: string
  deploymentId?: string
}

const SCRIPT_CLASS_NAMES = new Set(['Script', 'LocalScript', 'ModuleScript'])
const PART_CLASS_NAMES = new Set([
  'Part',
  'MeshPart',
  'UnionOperation',
  'WedgePart',
  'CornerWedgePart',
  'TrussPart',
  'Seat',
  'VehicleSeat',
  'ModelPart',
])

function isLuauScriptPath(path?: string): boolean {
  if (!path) return false
  const trimmed = path.trim()
  if (!trimmed) return false
  if (/\.lua(?:u)?$/i.test(trimmed)) return true
  return trimmed.startsWith('game.')
}

function hasLuauSource(props: Record<string, unknown> | undefined): boolean {
  if (!props) return false
  const source = (props as any)?.Source
  return typeof source === 'string' && source.trim().length > 0
}

function normalizeString(value?: string | null): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : undefined
  return trimmed ? trimmed : undefined
}

function parseLooseEdits(raw: string): Edit[] | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const body = trimmed[0] === '[' && trimmed[trimmed.length - 1] === ']'
    ? trimmed.slice(1, -1)
    : trimmed
  const chunks: string[] = []
  let depth = 0
  let current = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '{') {
      if (depth === 0) current = ''
      depth += 1
    }
    if (depth > 0) current += ch
    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        chunks.push(current)
        current = ''
      }
    }
  }
  if (!chunks.length) return undefined
  const edits: Edit[] = []
  for (const chunk of chunks) {
    const startLine = chunk.match(/"start"\s*:\s*\{[^}]*?"line"\s*:\s*(\d+)/)
    const startChar = chunk.match(/"start"\s*:\s*\{[^}]*?"character"\s*:\s*(\d+)/)
    const endLine = chunk.match(/"end"\s*:\s*\{[^}]*?"line"\s*:\s*(\d+)/)
    const endChar = chunk.match(/"end"\s*:\s*\{[^}]*?"character"\s*:\s*(\d+)/)
    const textIdx = chunk.indexOf('"text"')
    if (!startLine || !startChar || !endLine || !endChar || textIdx === -1) return undefined
    const firstQuote = chunk.indexOf('"', textIdx + 6)
    if (firstQuote === -1) return undefined
    const lastQuote = chunk.lastIndexOf('"')
    if (lastQuote <= firstQuote) return undefined
    let text = chunk.slice(firstQuote + 1, lastQuote)
    text = text.replace(/\\"/g, '"')
    text = text.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    edits.push({
      start: { line: Number(startLine[1]) || 0, character: Number(startChar[1]) || 0 },
      end: { line: Number(endLine[1]) || 0, character: Number(endChar[1]) || 0 },
      text,
    })
  }
  return edits
}

function normalizeEditsPayload(raw: unknown): Edit[] | undefined {
  if (!raw) return undefined
  if (Array.isArray(raw)) return raw as Edit[]
  if (typeof raw === 'object') return [raw as Edit]
  if (typeof raw === 'string') {
    const cleaned = stripCodeFences(raw)
    const coerced = coercePrimitive(cleaned)
    if (Array.isArray(coerced)) return coerced as Edit[]
    if (coerced && typeof coerced === 'object') return [coerced as Edit]
    const loose = parseLooseEdits(cleaned)
    if (loose) return loose
  }
  return undefined
}

function stripCodeFences(text: string): string {
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  return cleaned
}
function determineProvider(opts: { input: ChatInput; modelOverride?: string | null }): ProviderSelection | null {
  const { input, modelOverride } = opts
  const overrideRaw = normalizeString(modelOverride)
  const overrideIsGemini = !!overrideRaw && overrideRaw.toLowerCase().startsWith('gemini')
  const nvidiaKeyPresent = !!normalizeString(process.env.NVIDIA_API_KEY) || !!normalizeString(process.env.NVIDIA_VIM_API_KEY)
  const bedrockKeyPresent = !!normalizeString(process.env.AWS_BEARER_TOKEN_BEDROCK) || !!normalizeString(process.env.AWS_BEDROCK_API_KEY)

  // Vendor-style prefixes like "anthropic.", "qwen.", etc. strongly indicate Bedrock models
  const overrideHasVendorPrefix = !!overrideRaw && /^(anthropic|qwen|mistral|meta|cohere|ai21|amazon)\./i.test(overrideRaw)
  const overrideLooksVersioned = !!overrideRaw && /:\d|:v\d/i.test(overrideRaw)
  const overrideExplicitBedrock = !!overrideRaw && /^bedrock:/i.test(overrideRaw)
  const overrideIsBedrock = !!overrideRaw && !overrideIsGemini && (overrideHasVendorPrefix || overrideLooksVersioned || overrideExplicitBedrock)

  // Treat NVIDIA-style overrides as those without vendor prefix/version and that look like NVIDIA/NIM/Qwen3
  const overrideIsNvidia = !!overrideRaw && !overrideIsBedrock && (/^qwen3/i.test(overrideRaw) || /\bnim\b/i.test(overrideRaw) || /\bnvidia\b/i.test(overrideRaw) || /qwen-?coder/i.test(overrideRaw))
  const defaultProviderEnv = normalizeString(process.env.VECTOR_DEFAULT_PROVIDER)?.toLowerCase()
  const forceOpenRouter = (process.env.VECTOR_USE_OPENROUTER || '0') === '1'
  const debug = (process.env.VECTOR_DEBUG || process.env.PROVIDER_DEBUG || '0') === '1'

  const keys = {
    openai:     !!normalizeString(process.env.OPENAI_API_KEY),
    openrouter: !!normalizeString(process.env.OPENROUTER_API_KEY),
    gemini:     !!normalizeString(process.env.GEMINI_API_KEY),
    bedrock:    bedrockKeyPresent,
    nvidia:     nvidiaKeyPresent,
  }

  const preference: ProviderMode[] = []
  if (overrideRaw) preference.push(overrideIsGemini ? 'gemini' : (overrideIsBedrock ? 'bedrock' : (overrideIsNvidia ? 'nvidia' : 'openai')))
  if (input.provider?.name === 'openai') preference.push('openai')
  if (input.provider?.name === 'gemini') preference.push('gemini')
  if (input.provider?.name === 'openrouter') preference.push('openrouter')
  if ((input as any).provider?.name === 'bedrock') preference.push('bedrock')
  if ((input as any).provider?.name === 'nvidia') preference.push('nvidia')
  if (defaultProviderEnv === 'openai') preference.push('openai')
  if (defaultProviderEnv === 'gemini') preference.push('gemini')
  if (defaultProviderEnv === 'openrouter') preference.push('openrouter')
  if (defaultProviderEnv === 'bedrock') preference.push('bedrock')
  if (defaultProviderEnv === 'nvidia') preference.push('nvidia')
  if (forceOpenRouter) preference.push('openrouter')
  // Ensure we eventually try all providers as fallbacks in a deterministic order
  preference.push('openai', 'gemini', 'nvidia', 'bedrock', 'openrouter')

  const ordered: ProviderMode[] = []
  for (const mode of preference) {
    if (!ordered.includes(mode)) ordered.push(mode)
  }
  if (debug) console.log(`[provider.select] override=${overrideRaw || 'none'} default=${defaultProviderEnv || 'none'} keys=${JSON.stringify(keys)} order=${ordered.join('>')}`)

  for (const mode of ordered) {
    if (mode === 'openai') {
      const providerInput = input.provider?.name === 'openai' ? input.provider : undefined
      const apiKey = normalizeString(providerInput?.apiKey) || normalizeString(process.env.OPENAI_API_KEY)
      if (!apiKey) continue
      const model =
        normalizeString(providerInput?.model) ||
        (overrideRaw && !overrideIsGemini && !overrideIsBedrock && !overrideIsNvidia ? overrideRaw : undefined) ||
        normalizeString(process.env.OPENAI_MODEL)
      const baseUrl = normalizeString(providerInput?.baseUrl) || normalizeString(process.env.OPENAI_API_BASE_URL)
      return { mode, apiKey, model, baseUrl }
    }

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

    if (mode === 'bedrock') {
      const providerInput = (input as any).provider?.name === 'bedrock' ? ((input as any).provider as any) : undefined
      const apiKey = normalizeString(providerInput?.apiKey) || normalizeString(process.env.AWS_BEARER_TOKEN_BEDROCK) || normalizeString(process.env.AWS_BEDROCK_API_KEY)
      if (!apiKey) continue
      const model =
        normalizeString(providerInput?.model) ||
        (overrideIsBedrock ? overrideRaw : undefined) ||
        normalizeString(process.env.BEDROCK_MODEL) ||
        normalizeString(process.env.AWS_BEDROCK_MODEL)
      const region = normalizeString((providerInput as any)?.region) || normalizeString(process.env.AWS_BEDROCK_REGION)
      return { mode, apiKey, model, region }
    }

    if (mode === 'nvidia') {
      const providerInput = (input as any).provider?.name === 'nvidia' ? ((input as any).provider as any) : undefined
      const apiKey = normalizeString(providerInput?.apiKey) || normalizeString(process.env.NVIDIA_API_KEY) || normalizeString(process.env.NVIDIA_VIM_API_KEY)
      if (!apiKey) continue
      const model = normalizeString(providerInput?.model) || (overrideIsNvidia ? overrideRaw : undefined) || normalizeString(process.env.NVIDIA_MODEL)
      const baseUrl = normalizeString(providerInput?.baseUrl) || normalizeString(process.env.NVIDIA_API_BASE_URL)
      const deploymentId = normalizeString((providerInput as any)?.deploymentId) || normalizeString(process.env.NVIDIA_DEPLOYMENT_ID)
      if (debug) console.log(`[provider.select] choose=nvidia model=${model || 'default'} base=${baseUrl || 'default'} deployment=${deploymentId || 'none'}`)
      return { mode, apiKey, model, baseUrl, deploymentId }
    }
  }

  return null
}

const PROMPT_SECTIONS = [
  `You are Vector, a Roblox Studio copilot.`,
  `Core rules
- One tool per turn: emit EXACTLY ONE tool tag. It must be the last output (ignoring trailing whitespace). Wait for the tool result before continuing.
- Proposal-first and undoable: never change code/Instances outside a tool; keep each step small and reviewable.
- Plan when work spans multiple steps. For a single obvious action you may act without <start_plan>.
- Keep responses to that single tool tag (no markdown or invented tags). Optional brief explanatory text may appear before the tag when allowed.` ,
  `Planning details
- For non-trivial tasks, your <start_plan> MUST list detailed, tool-specific steps (8–15 typical): include the tool name, exact target (class/path/name), and the intended outcome. Example: "Create Model 'Base' under game.Workspace", "Search assets query='barracks'", "Insert asset 12345 under game.Workspace.Base", "Set CFrame for 'Gate' to (0,0,50)", "Open or create Script 'BaseBuilder'", "Show diff to add idempotent Luau".`,
  `Default Script Policy
- Whenever you create, modify, or insert Instances (create_instance/set_properties/rename_instance/delete_instance/insert_asset/generate_asset_3d), you must author Luau that rebuilds the result before completing.
- Preferred flow: open_or_create_script → show_diff (or apply_edit when already previewed). Scripts must be valid, idempotent, and set Anchored/props explicitly.
- Skip Luau only when the user explicitly opts out (e.g., "geometry only", "no script", "no code"). Otherwise completion is blocked.`,
  `Tool calls
<tool_name>
  <param>...</param>
</tool_name>
- Omit optional params you don’t know.
- JSON goes inside the tag as strict JSON (double quotes, no trailing commas).
- For show_diff/apply_edit the <edits> tag MUST contain a JSON array of edit objects (example: [{"start":{...},"end":{...},"text":"..."}]); never pass a plain string.
- For show_diff/apply_edit when using <files>, every files[i].edits must also be that same JSON array (no strings, no code fences).`,
  `Encoding & hygiene
- Strings/numbers are literal. JSON must not be wrapped in quotes or code fences.
- Paths use GetFullName() with brackets for special characters.
- Attributes use "@Name" keys.
- Edits are 0-based, non-overlapping, ≤20 edits and ≤2000 inserted chars.`,
  `Assets & 3D
  - Prefer search_assets → insert_asset for props/models. Use create_instance only for simple primitive geometry or when catalog search fails/disabled.
  - Composite scenes (e.g., park, plaza, town square): it is acceptable to add multiple distinct assets (e.g., trees, benches, fountain, lights) as separate search_assets → insert_asset steps in the plan. Keep it concise: 2–4 categories initially, each with limit ≤ 6.
  - Single‑subject builds (e.g., hospital, watch tower): avoid adding unrelated props unless requested. If a container model (e.g., game.Workspace.Hospital) already exists, do not recreate it; prefer inserting exactly one primary asset (e.g., a hospital building) under a sensible child like "Imported", or add obviously missing interior kits/furnishings.
  - In Auto mode (autoApply=true), prefer choosing a single best match and inserting it directly without listing. Do not insert multiples unless the user explicitly asks for more than one.
  - search_assets limit ≤ 6 unless the user asks. Include helpful tags.
  - insert_asset defaults parentPath to game.Workspace if unknown. Before creating or inserting, inspect existing children (list_children) and skip duplicates when names/roles already exist.`,
  `Scene building
  - Always think through the layout before acting: use <start_plan> to outline the main structures, then execute steps one tool at a time.
  - Inspect what already exists. If nothing is selected, call <list_children> on game.Workspace (depth 1–2) to inventory the scene; also use <list_selection> and <get_active_script>. Reuse or extend Models instead of duplicating them.
  - Build geometry iteratively with create_instance/set_properties, anchoring parts and setting Size/CFrame so progress is visible in Workspace.
  - Only switch to scripting when the user explicitly wants reusable code or behaviour. Otherwise stay in direct manipulation mode.`,
  `Quality checks
- Derive a short checklist from the user prompt and track progress (optionally via <message phase="update">).
- Do not call <complete> until every checklist item exists and the matching Luau is written (unless the user opted out).
- Created Models must contain anchored, visible parts or code that produces them.`,
  `Validation & recovery
- On VALIDATION_ERROR, retry the SAME tool once with corrected args (no commentary or tool switching).
- If you would otherwise reply with no tool, either choose exactly one tool or finish with <complete>.`,
String.raw`Quick examples
Detailed plan (assets-first)
<start_plan>
  <steps>[
    "Create Model 'MilitaryBase' under game.Workspace",
    "Search assets query='watch tower' tags=['model'] limit=6",
    "Insert asset <ID_FROM_RESULTS> under game.Workspace.MilitaryBase",
    "Search assets query='barracks' tags=['model'] limit=6",
    "Insert asset <ID_FROM_RESULTS> under game.Workspace.MilitaryBase",
    "Search assets query='fence' tags=['model'] limit=6",
    "Insert asset <ID_FROM_RESULTS> under game.Workspace.MilitaryBase",
    "Set properties (Anchored, CFrame) to arrange towers, barracks, fence perimeter",
    "Open or create Script 'BaseBuilder' in game.ServerScriptService",
    "Show diff to add idempotent Luau that rebuilds the base"
  ]</steps>
</start_plan>

Insert an asset (preferred)
<search_assets>
  <query>oak tree</query>
  <tags>["tree","nature"]</tags>
  <limit>6</limit>
</search_assets>

<insert_asset>
  <assetId>123456789</assetId>
  <parentPath>game.Workspace</parentPath>
</insert_asset>

Build simple geometry (generic)
<start_plan>
  <steps>["Create 'Structure' model under Workspace","Create 'Floor' Part with size 16x1x16 at y=0.5 Anchored","Create 'WallFront' Part 16x8x1 at z=-7.5 Anchored","Create 'Roof' Part 16x1x16 with slight tilt Anchored"]</steps>
</start_plan>

<create_instance>
  <className>Model</className>
  <parentPath>game.Workspace</parentPath>
  <props>{"Name":"Structure"}</props>
</create_instance>

<create_instance>
  <className>Part</className>
  <parentPath>game.Workspace.Structure</parentPath>
  <props>{"Name":"Floor","Anchored":true,"Size":{"__t":"Vector3","x":16,"y":1,"z":16},"CFrame":{"__t":"CFrame","comps":[0,0.5,0, 1,0,0, 0,1,0, 0,0,1]},"Material":{"__t":"EnumItem","enum":"Enum.Material","name":"WoodPlanks"}}</props>
</create_instance>

<create_instance>
  <className>Part</className>
  <parentPath>game.Workspace.Structure</parentPath>
  <props>{"Name":"WallFront","Anchored":true,"Size":{"__t":"Vector3","x":16,"y":8,"z":1},"CFrame":{"__t":"CFrame","comps":[0,4.5,-7.5, 1,0,0, 0,1,0, 0,0,1]},"Material":{"__t":"EnumItem","enum":"Enum.Material","name":"Brick"}}</props>
</create_instance>

<create_instance>
  <className>Part</className>
  <parentPath>game.Workspace.Structure</parentPath>
  <props>{"Name":"Roof","Anchored":true,"Size":{"__t":"Vector3","x":16,"y":1,"z":16},"CFrame":{"__t":"CFrame","comps":[0,8.6,0, 1,0,0, 0,0.5,-0.8660254, 0,0.8660254,0.5]},"Color":{"__t":"Color3","r":0.6,"g":0.2,"b":0.2}}</props>
</create_instance>`
]

const SYSTEM_PROMPT = PROMPT_SECTIONS.join('\n\n')
  + '\n'
  + PLANNER_GUIDE
  + '\n'
  + COMPLEXITY_DECISION_GUIDE
  + '\n'
  + TOOL_REFERENCE
  + '\n'
  + QUALITY_CHECK_GUIDE
  + '\n'
  + EXAMPLES_POLICY
  + '\n'
  + ROLE_SCOPE_GUIDE


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

function escapeBareNewlinesInJson(value: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '"' && !escaped) {
      inString = !inString
      result += ch
      continue
    }
    if ((ch === '\n' || ch === '\r') && inString) {
      if (ch === '\r' && value[i + 1] === '\n') {
        result += '\\r\\n'
        i += 1
      } else if (ch === '\r') {
        result += '\\r'
      } else {
        result += '\\n'
      }
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = !escaped
      result += ch
      continue
    }
    escaped = false
    result += ch
  }
  return result
}

function coercePrimitive(v: string): any {
  const t = v.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null
  if (!isNaN(Number(t))) return Number(t)
  let fenceUnwrapped = t
  if (fenceUnwrapped.startsWith('```')) {
    fenceUnwrapped = fenceUnwrapped
      .replace(/^```[^\n]*\n?/, '')
      .replace(/```$/, '')
      .trim()
    const fenceParsed = fenceUnwrapped ? tryParseStrictJSON(fenceUnwrapped) : undefined
    if (fenceParsed !== undefined) return fenceParsed
  }
  // Try strict JSON first
  const jStrict = tryParseStrictJSON(t)
  if (jStrict !== undefined) return jStrict
  const newlineSanitized = escapeBareNewlinesInJson(t)
  if (newlineSanitized !== t) {
    const parsed = tryParseStrictJSON(newlineSanitized)
    if (parsed !== undefined) return parsed
  }
  // JSON5-like fallback for common LLM outputs: single quotes, unquoted keys, trailing commas, fenced code
  const jsonishSource = fenceUnwrapped.length !== t.length ? fenceUnwrapped : t
  if ((jsonishSource.startsWith('{') && jsonishSource.endsWith('}')) || (jsonishSource.startsWith('[') && jsonishSource.endsWith(']'))) {
    let s = jsonishSource
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

export type ParsedTool = {
  name: string
  args: Record<string, any>
  prefixText: string
  suffixText: string
  innerRaw: string
}

export function parseToolXML(text: string): ParsedTool | null {
  if (!text) return null
  const toolRe = /<([a-zA-Z_][\w]*)>([\s\S]*?)<\/\1>/
  const toolMatch = toolRe.exec(text)
  if (!toolMatch) return null
  const name = toolMatch[1]
  const inner = toolMatch[2]
  const prefixText = text.slice(0, toolMatch.index || 0)
  const suffixText = text.slice((toolMatch.index || 0) + toolMatch[0].length)
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
    if (asJson && typeof asJson === 'object') {
      return { name, args: asJson as any, prefixText, suffixText, innerRaw: inner }
    }
  }
  return { name, args, prefixText, suffixText, innerRaw: inner }
}

function parseXmlObject(input: string): Record<string, any> | null {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (!s.startsWith('<')) return null
  const tagRe = /<([a-zA-Z_][\w]*)>([\s\S]*?)<\/\1>/g
  const out: Record<string, any> = {}
  let matched = false
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(s))) {
    matched = true
    const key = m[1]
    const raw = m[2]
    const hasNested = /<([a-zA-Z_][\w]*)>/.test(raw)
    out[key] = hasNested ? (parseXmlObject(raw) ?? coercePrimitive(raw)) : coercePrimitive(raw)
  }
  return matched ? out : null
}

function toClassWhitelist(raw: any): Record<string, boolean> | undefined {
  const emit = (names: string[]): Record<string, boolean> | undefined => {
    const out: Record<string, boolean> = {}
    for (const n of names) {
      const t = String(n || '').trim()
      if (t) out[t] = true
    }
    return Object.keys(out).length ? out : undefined
  }
  if (raw == null) return undefined
  // If it came as a string, try JSON/CSV/space split first
  if (typeof raw === 'string') {
    const xmlObj = parseXmlObject(raw)
    if (xmlObj) return toClassWhitelist(xmlObj)
    try {
      const parsed = JSON.parse(raw)
      return toClassWhitelist(parsed)
    } catch {}
    const parts = raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return emit(parts)
  }
  // If it is an array, interpret as list of names
  if (Array.isArray(raw)) {
    const names: string[] = []
    for (const v of raw) {
      if (typeof v === 'string') names.push(v)
      else if (v && typeof v === 'object' && typeof (v as any).Class === 'string') names.push(String((v as any).Class))
      else if (v && typeof v === 'object' && typeof (v as any).Name === 'string') names.push(String((v as any).Name))
    }
    return emit(names)
  }
  // If it is an object, accept direct { Class: true } or { Classes: [ ... ] }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, any>
    if (Array.isArray(obj.Classes)) return toClassWhitelist(obj.Classes)
    if (typeof obj.Class === 'string') return emit([obj.Class])
    const out: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'boolean') out[String(k)] = !!v
      else if (Array.isArray(v)) {
        const nested = toClassWhitelist(v)
        if (nested) Object.assign(out, nested)
      }
    }
    return Object.keys(out).length ? out : undefined
  }
  return undefined
}

function toEditArray(editsRaw: any): Edit[] | null {
  let parsed: any
  if (Array.isArray(editsRaw)) {
    parsed = editsRaw
  } else if (typeof editsRaw === 'string') {
    const cleaned = stripCodeFences(editsRaw)
    parsed = tryParseJSON(cleaned)
    if (!parsed) parsed = coercePrimitive(cleaned)
    if (!parsed) parsed = parseLooseEdits(cleaned)
  } else {
    parsed = tryParseJSON(editsRaw)
  }
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

type MapToolExtras = {
  getScriptSource?: (path: string) => string | undefined
  recordScriptSource?: (path: string, text: string) => void
  recordPlanStart?: (steps: string[]) => void
  recordPlanUpdate?: (update: { completedStep?: string; nextStep?: string; notes?: string }) => void
  userOptedOut?: boolean
  geometryTracker?: { sawCreate: boolean; sawParts: boolean }
}

type MapResult = { proposals: Proposal[]; missingContext?: string; contextResult?: any }

function mapToolToProposals(
  name: string,
  a: Record<string, any>,
  input: ChatInput,
  msg: string,
  extras?: MapToolExtras,
): MapResult {
  const proposals: Proposal[] = []
  const ensurePath = (fallback?: string | null): string | undefined => {
    const p = typeof a.path === 'string' ? a.path : undefined
    return p || (fallback || undefined)
  }
  if (name === 'start_plan') {
    const steps = Array.isArray((a as any).steps) ? (a as any).steps.map(String) : []
    if (!steps.length) {
      return { proposals, missingContext: 'Provide at least one plan step.' }
    }
    extras?.recordPlanStart?.(steps)
    return { proposals, contextResult: { steps } }
  }
  if (name === 'update_plan') {
    const completedStep = typeof (a as any).completedStep === 'string' ? (a as any).completedStep : undefined
    const nextStep = typeof (a as any).nextStep === 'string' ? (a as any).nextStep : undefined
    const notes = typeof (a as any).notes === 'string' ? (a as any).notes : undefined
    extras?.recordPlanUpdate?.({ completedStep, nextStep, notes })
    return { proposals, contextResult: { completedStep, nextStep, notes } }
  }
  if (name === 'show_diff' || name === 'apply_edit') {
    if (extras?.userOptedOut) {
      return { proposals, missingContext: 'Scripting is disabled for this request; use object tools instead.' }
    }
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
        if (isLuauScriptPath(entry.path) && typeof proposed === 'string') {
          extras?.recordScriptSource?.(entry.path, proposed)
        }
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
      if (isLuauScriptPath(path) && typeof next === 'string') {
        extras?.recordScriptSource?.(path, next)
      }
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
      const childClass = (a as any).className as string
      const childProps = (a as any).props as Record<string, unknown> | undefined
      const ops: ObjectOp[] = []

      // Build known scene paths, with and without 'game.' prefix for services
      const nodes = Array.isArray(input.context.scene?.nodes) ? input.context.scene!.nodes! : []
      const known = new Set<string>()
      const SERVICE_PREFIXES = ['Workspace','ReplicatedStorage','ServerStorage','StarterGui','StarterPack','StarterPlayer','Lighting','Teams','SoundService','TextService','CollectionService']
      for (const n of nodes) {
        if (!n || typeof (n as any).path !== 'string') continue
        const p = (n as any).path as string
        known.add(p)
        const head = p.split('.')[0]
        if (SERVICE_PREFIXES.includes(head)) known.add(`game.${p}`)
      }

      const looksLikeWorkspace = /^game\.Workspace(?:\.|$)/i.test(parentPath) || /^Workspace(?:\.|$)/.test(parentPath)
      if (looksLikeWorkspace) {
        // Walk up and create missing ancestors as Models under Workspace
        const chain: { parent: string; name: string }[] = []
        let cur = parentPath
        let guard = 0
        while (cur && !known.has(cur) && guard++ < 10) {
          const noGame = cur.replace(/^game\./, '')
          if (known.has(noGame)) break
          const split = splitInstancePath(cur)
          const inferredParent = split.parentPath || 'game.Workspace'
          const inferredName = split.name || 'Model'
          if (/^game\.Workspace$/i.test(inferredParent) || /^Workspace$/i.test(inferredParent)) {
            const normalizedParent = /^Workspace$/i.test(inferredParent) ? 'game.Workspace' : inferredParent
            chain.push({ parent: normalizedParent, name: inferredName })
          }
          if (!split.parentPath || /^game\.Workspace$/i.test(split.parentPath) || /^Workspace$/i.test(split.parentPath)) break
          cur = split.parentPath
        }
        for (let i = chain.length - 1; i >= 0; i--) {
          const seg = chain[i]
          ops.push({ op: 'create_instance', className: 'Model', parentPath: seg.parent, props: { Name: seg.name } })
          const createdPath = buildInstancePath(seg.parent.replace(/^game\./, ''), seg.name).replace(/^Workspace\./, 'Workspace.')
          known.add(createdPath)
          known.add(`game.${createdPath}`)
        }
      }

      ops.push({ op: 'create_instance', className: childClass, parentPath, props: childProps })
      proposals.push({ id: id('obj'), type: 'object_op', ops, notes: 'Parsed from create_instance' })
      if (extras?.geometryTracker) {
        extras.geometryTracker.sawCreate = true
        extras.geometryTracker.sawParts ||= PART_CLASS_NAMES.has(childClass)
      }
      if (SCRIPT_CLASS_NAMES.has(childClass) && hasLuauSource(childProps as Record<string, unknown>)) {
        const props = (childProps || {}) as Record<string, unknown>
        const nameProp = typeof props['Name'] === 'string' ? String(props['Name']) : 'Script'
        const sourceText = String(props['Source'] as string)
        const targetPath = buildInstancePath(parentPath, nameProp)
        extras?.recordScriptSource?.(targetPath, sourceText)
      }
      return { proposals }
    }
    if (!parentPath) return { proposals, missingContext: 'Need parent selection to create instance.' }
  }
  if (name === 'set_properties') {
    if (typeof (a as any).path === 'string' && (a as any).props && typeof (a as any).props === 'object') {
      const op: ObjectOp = { op: 'set_properties', path: (a as any).path, props: (a as any).props }
      proposals.push({ id: id('obj'), type: 'object_op', ops: [op], notes: 'Parsed from set_properties' })
      if (extras?.geometryTracker) {
        const props = (a as any).props || {}
        extras.geometryTracker.sawParts ||= ['Size', 'CFrame', 'Position', 'Anchored', 'Transparency', 'Color', 'Shape', 'Material'].some((key) => Object.prototype.hasOwnProperty.call(props, key))
      }
      if (isLuauScriptPath(op.path) && hasLuauSource(op.props as Record<string, unknown>)) {
        const props = (op.props || {}) as Record<string, unknown>
        extras?.recordScriptSource?.(op.path, String(props['Source']))
      }
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
      if (extras?.geometryTracker) {
        extras.geometryTracker.sawCreate = true
        extras.geometryTracker.sawParts = true
      }
      return { proposals }
    }
    return { proposals, missingContext: 'Need assetId to insert asset.' }
  }
  if (name === 'generate_asset_3d') {
    if (typeof (a as any).prompt === 'string') {
      proposals.push({ id: id('asset'), type: 'asset_op', generate3d: { prompt: (a as any).prompt, tags: Array.isArray((a as any).tags) ? (a as any).tags.map(String) : undefined, style: typeof (a as any).style === 'string' ? (a as any).style : undefined, budget: typeof (a as any).budget === 'number' ? (a as any).budget : undefined } })
      if (extras?.geometryTracker) {
        extras.geometryTracker.sawCreate = true
        extras.geometryTracker.sawParts = true
      }
      return { proposals }
    }
  }
  if (name === 'open_or_create_script') {
    if (extras?.userOptedOut) {
      return { proposals, missingContext: 'Scripting is disabled for this request; operate directly on Instances instead.' }
    }
    const rawPath = typeof (a as any).path === 'string' ? (a as any).path.trim() : undefined
    const rawParent = typeof (a as any).parentPath === 'string' ? (a as any).parentPath.trim() : undefined
    const rawName = typeof (a as any).name === 'string' ? (a as any).name.trim() : undefined

    let targetPath = rawPath && rawPath.length ? rawPath : undefined
    let parentPath = rawParent && rawParent.length ? rawParent : undefined
    let scriptName = rawName && rawName.length ? rawName : undefined

    if (!targetPath) {
      if (!parentPath || !scriptName) {
        return { proposals, missingContext: 'Need script path or (parentPath + name).' }
      }
      targetPath = buildInstancePath(parentPath, scriptName)
    } else {
      const split = splitInstancePath(targetPath)
      if (split) {
        parentPath = parentPath || split.parentPath
        scriptName = scriptName || split.name
      }
    }

    if (!parentPath) {
      return { proposals, missingContext: 'Unable to determine parent path for script.' }
    }
    if (!scriptName) {
      scriptName = 'Script'
      targetPath = buildInstancePath(parentPath, scriptName)
    }

    const knownSource = targetPath ? extras?.getScriptSource?.(targetPath) : undefined
    let created = false
    let text = typeof knownSource === 'string' ? knownSource : ''

    if (targetPath && typeof knownSource !== 'string') {
      created = true
      text = ''
      const op: ObjectOp = {
        op: 'create_instance',
        className: 'Script',
        parentPath,
        props: { Name: scriptName, Source: text },
      }
      proposals.push({
        id: id('obj'),
        type: 'object_op',
        notes: 'Ensure script exists before editing.',
        ops: [op],
      })
      extras?.recordScriptSource?.(targetPath, text)
    }

    return { proposals, contextResult: { path: targetPath, text, created } }
  }
  if (name === 'complete') {
    const summary = typeof (a as any).summary === 'string' ? (a as any).summary : undefined
    const confidence = typeof (a as any).confidence === 'number' ? (a as any).confidence : undefined
    if (extras?.userOptedOut && extras.geometryTracker) {
      if (!extras.geometryTracker.sawCreate || !extras.geometryTracker.sawParts) {
        return { proposals, missingContext: 'Need to place visible parts in the scene before completing.' }
      }
    }
    if (summary && summary.trim().length > 0) {
      proposals.push({ id: id('done'), type: 'completion', summary, confidence })
      return { proposals }
    }
  }
  if (name === 'final_message') {
    const text = typeof (a as any).text === 'string' ? (a as any).text : undefined
    const confidence = typeof (a as any).confidence === 'number' ? (a as any).confidence : undefined
    if (extras?.userOptedOut && extras.geometryTracker) {
      if (!extras.geometryTracker.sawCreate || !extras.geometryTracker.sawParts) {
        return { proposals, missingContext: 'Need to place visible parts in the scene before completing.' }
      }
    }
    if (text && text.trim().length > 0) {
      proposals.push({ id: id('done'), type: 'completion', summary: text, confidence })
      return { proposals }
    }
  }
  if (name === 'message') {
    const text = typeof (a as any).text === 'string' ? (a as any).text : undefined
    const phase = typeof (a as any).phase === 'string' ? (a as any).phase : 'update'
    if (extras?.userOptedOut && extras.geometryTracker && phase.toLowerCase() === 'final') {
      if (!extras.geometryTracker.sawCreate || !extras.geometryTracker.sawParts) {
        return { proposals, missingContext: 'Need to place visible parts in the scene before completing.' }
      }
    }
    if (text && text.trim().length > 0) {
      // For 'final' we also return a completion so it shows in proposals
      if (phase === 'final') {
        proposals.push({ id: id('done'), type: 'completion', summary: text })
      }
      return { proposals }
    }
  }
  if (name === 'attempt_completion') {
    const result = typeof (a as any).result === 'string' ? (a as any).result : undefined
    const confidence = typeof (a as any).confidence === 'number' ? (a as any).confidence : undefined
    if (extras?.userOptedOut && extras.geometryTracker) {
      if (!extras.geometryTracker.sawCreate || !extras.geometryTracker.sawParts) {
        return { proposals, missingContext: 'Need to place visible parts in the scene before completing.' }
      }
    }
    if (result && result.trim().length > 0) {
      proposals.push({ id: id('done'), type: 'completion', summary: result, confidence })
      return { proposals }
    }
  }
  return { proposals }
}

function proposalTouchesLuau(proposal: Proposal): boolean {
  if (!proposal) return false
  if (proposal.type === 'edit') {
    const files = proposal.files || []
    return files.some((file) => isLuauScriptPath(file?.path))
  }
  if (proposal.type === 'object_op') {
    return proposal.ops.some((op) => {
      if (op.op === 'create_instance' && SCRIPT_CLASS_NAMES.has(op.className)) {
        return hasLuauSource(op.props as Record<string, unknown> | undefined)
      }
      if (op.op === 'set_properties') {
        if (!hasLuauSource(op.props as Record<string, unknown> | undefined)) return false
        return isLuauScriptPath(op.path)
      }
      return false
    })
  }
  return false
}

const SCRIPT_OPT_OUT_PATTERNS = [
  /\bno\s+(?:script|scripts|code)\b/i,
  /\bwithout\s+(?:any\s+)?(?:script|scripts|code)\b/i,
  /\bno\s+scripting\b/i,
  /\bgeometry\s+only\b/i,
  /\bjust\s+(?:place|build)\s+parts\b/i,
  /\bno\s+lua\b/i,
]

const SCRIPT_OPT_IN_PATTERNS = [
  /\binclude\s+(?:the\s+)?(?:script|code)\b/i,
  /\bwith\s+(?:a\s+)?script\b/i,
  /\badd\s+(?:the\s+)?script\b/i,
  /\bwrite\s+(?:the\s+)?code\b/i,
  /\bprovide\s+(?:the\s+)?script\b/i,
]

const GEOMETRY_INTENT_PATTERNS = [
  /\b(build|create|make|spawn|place|add|put|drop)\b[^.!?]{0,120}\b(house|building|structure|scene|environment|world|level|map|terrain|tower|bridge|park|city|village|room|base|farm|garden|landscape)\b/i,
  /\bpopulate\b[^.!?]{0,120}\b(scene|world|environment)\b/i,
  /\bdecorate\b[^.!?]{0,120}\b(scene|area|room)\b/i,
]

function detectScriptOptPreference(text: string): boolean | null {
  if (!text) return null
  if (SCRIPT_OPT_OUT_PATTERNS.some((pat) => pat.test(text))) return true
  if (SCRIPT_OPT_IN_PATTERNS.some((pat) => pat.test(text))) return false
  if (GEOMETRY_INTENT_PATTERNS.some((pat) => pat.test(text))) return true
  return null
}

function ensureScriptPolicy(state: TaskState): ScriptPolicyState {
  if (!state.policy || typeof state.policy !== 'object') {
    state.policy = { geometryOps: 0, luauEdits: 0 }
    return state.policy
  }
  if (typeof state.policy.geometryOps !== 'number' || Number.isNaN(state.policy.geometryOps)) {
    state.policy.geometryOps = 0
  }
  if (typeof state.policy.luauEdits !== 'number' || Number.isNaN(state.policy.luauEdits)) {
    state.policy.luauEdits = 0
  }
  return state.policy
}

function proposalTouchesGeometry(proposal: Proposal): boolean {
  if (!proposal) return false
  if (proposal.type === 'object_op') {
    return proposal.ops.some((op) => {
      if (op.op === 'create_instance') {
        if (SCRIPT_CLASS_NAMES.has(op.className)) {
          return !hasLuauSource(op.props as Record<string, unknown> | undefined)
        }
        return true
      }
      if (op.op === 'set_properties') {
        const isScriptPath = isLuauScriptPath(op.path)
        const hasSource = hasLuauSource(op.props as Record<string, unknown> | undefined)
        if (isScriptPath && hasSource) return false
        return true
      }
      if (op.op === 'rename_instance' || op.op === 'delete_instance') {
        return !isLuauScriptPath(op.path)
      }
      return false
    })
  }
  if (proposal.type === 'asset_op') {
    if (proposal.insert) return true
    if (proposal.generate3d) return true
    return false
  }
  return false
}

export async function runLLM(input: ChatInput): Promise<{ proposals: Proposal[]; taskState: TaskState; tokenTotals: { in: number; out: number } }> {
  const rawMessage = input.message.trim()
  const { cleaned, attachments } = await extractMentions(rawMessage)
  const msg = cleaned.length > 0 ? cleaned : rawMessage
  const modelOverride = typeof input.modelOverride === 'string' && input.modelOverride.trim().length > 0
    ? input.modelOverride.trim()
    : undefined
  const autoEnabled = !!(input as any).autoApply

  const taskId = (input as any).workflowId || input.projectId
  let taskState = loadTaskState(taskId)
  ensureScriptPolicy(taskState)
  const updateState = (fn: (state: TaskState) => void) => {
    taskState = updateTaskState(taskId, (state) => {
      ensureScriptPolicy(state)
      fn(state)
      ensureScriptPolicy(state)
    })
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

  const definitionsEqual = (a?: DefinitionInfo[] | null, b?: DefinitionInfo[] | null): boolean => {
    const listA = Array.isArray(a) ? a : []
    const listB = Array.isArray(b) ? b : []
    if (listA.length !== listB.length) return false
    for (let i = 0; i < listA.length; i++) {
      const da = listA[i]
      const db = listB[i]
      if (!db) return false
      if (da.file !== db.file || da.line !== db.line || da.name !== db.name) return false
    }
    return true
  }

  const initialDefinitions = setCodeDefinitionCache(taskId, taskState.codeDefinitions)
  if (!definitionsEqual(taskState.codeDefinitions, initialDefinitions)) {
    updateState((state) => {
      state.codeDefinitions = initialDefinitions
    })
  } else {
    taskState.codeDefinitions = initialDefinitions
  }

  const scriptSources: Record<string, string> = { ...(taskState.scriptSources || {}) }
  const normalizeScriptPath = (path?: string) => (path || '').trim()
  const getScriptSource = (path: string): string | undefined => {
    const key = normalizeScriptPath(path)
    if (!key) return undefined
    return scriptSources[key]
  }
  const recordScriptSource = (path?: string, text?: string) => {
    const key = normalizeScriptPath(path)
    if (!key || typeof text !== 'string') return
    if (scriptSources[key] === text) return
    scriptSources[key] = text
    updateState((state) => {
      const next = { ...(state.scriptSources || {}) }
      next[key] = text
      state.scriptSources = next
    })
  }

  const recordPlanStart = (steps: string[]) => {
    const normalized = steps.map((s) => (typeof s === 'string' ? s.trim() : '')).filter((s) => s.length > 0)
    updateState((state) => {
      state.plan = { steps: normalized, completed: [], currentIndex: 0 }
    })
    pushChunk(streamKey, 'plan.start ' + JSON.stringify(normalized))
  }

  const recordPlanUpdate = (update: { completedStep?: string; nextStep?: string; notes?: string }) => {
    updateState((state) => {
      if (!state.plan) {
        state.plan = { steps: [], completed: [], currentIndex: 0 }
      }
      const plan = state.plan!
      if (update.completedStep) {
        const idx = plan.steps.findIndex((step) => step === update.completedStep)
        if (idx >= 0 && !plan.completed.includes(update.completedStep)) {
          plan.completed.push(update.completedStep)
          plan.currentIndex = Math.min(idx + 1, plan.steps.length - 1)
        }
      }
      if (update.nextStep) {
        const idx = plan.steps.findIndex((step) => step === update.nextStep)
        if (idx >= 0) {
          plan.currentIndex = idx
        }
      }
      if (typeof update.notes === 'string' && update.notes.trim().length > 0) {
        plan.notes = update.notes.trim()
      }
    })
    pushChunk(streamKey, 'plan.update ' + JSON.stringify(update))
  }

  let userOptedOut = !!taskState.policy?.userOptedOut
  let scriptWorkObserved = (taskState.policy?.luauEdits || 0) > 0
  let geometryWorkObserved = (taskState.policy?.geometryOps || 0) > 0

  appendHistory('user', msg)
  attachments.forEach((att) => {
    appendHistory('system', `[attachment:${att.type}] ${att.label}\n${att.content}`)
  })
  const scriptPreference = detectScriptOptPreference(msg)
  if (scriptPreference !== null) {
    userOptedOut = scriptPreference
    updateState((state) => {
      const policy = ensureScriptPolicy(state)
      policy.userOptedOut = scriptPreference
      policy.lastOptOutAt = Date.now()
    })
  }
  const geometryTracker = userOptedOut ? { sawCreate: false, sawParts: false } : undefined
  updateState((state) => {
    state.autoApproval.enabled = autoEnabled
    state.autoApproval.readFiles = autoEnabled
    state.autoApproval.editFiles = autoEnabled
    state.autoApproval.execSafe = autoEnabled
    if (typeof state.counters.contextRequests !== 'number') state.counters.contextRequests = 0
  })

  if (input.context.scene && Array.isArray(input.context.scene.nodes)) {
    updateState((state) => {
      hydrateSceneSnapshot(state, input.context.scene)
    })
  }

  const contextHasDefinitions = Object.prototype.hasOwnProperty.call(input.context as any, 'codeDefinitions')
  if (contextHasDefinitions) {
    const defsRaw = Array.isArray((input.context as any).codeDefinitions)
      ? ((input.context as any).codeDefinitions as DefinitionInfo[])
      : []
    const sanitizedDefs = setCodeDefinitionCache(taskId, defsRaw)
    if (!definitionsEqual(taskState.codeDefinitions, sanitizedDefs)) {
      updateState((state) => {
        state.codeDefinitions = sanitizedDefs
      })
    } else {
      taskState.codeDefinitions = sanitizedDefs
    }
  }

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

  let messages: { role: 'user' | 'assistant' | 'system'; content: string }[] | null = null
  let assetFallbackWarningSent = false
  const catalogSearchAvailable = (process.env.CATALOG_DISABLE_SEARCH || '0') !== '1'
  let scriptWarnings = 0

  const finalize = (list: Proposal[]): { proposals: Proposal[]; taskState: TaskState; tokenTotals: { in: number; out: number } } => {
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
    return { proposals: annotated, taskState, tokenTotals: { in: totalsIn, out: totalsOut } }
  }

  // Deterministic templates for milestone verification
  const proposals: Proposal[] = []

  const toXml = (name: string, args: Record<string, any>): string => {
    const parts: string[] = [`<${name}>`]
    for (const [k, v] of Object.entries(args || {})) {
      const val = typeof v === 'string' ? v : JSON.stringify(v)
      parts.push(`  <${k}>${val}</${k}>`)
    }
    parts.push(`</${name}>`)
    return parts.join('\n')
  }

  const fallbacksEnabled = typeof (input as any).enableFallbacks === 'boolean'
    ? (input as any).enableFallbacks
    : (process.env.VECTOR_DISABLE_FALLBACKS || '0') !== '1'
  const fallbacksDisabled = !fallbacksEnabled
  const allowTextBeforeTool = (process.env.VECTOR_ALLOW_TEXT_BEFORE_TOOL || '0') === '1'
  const enforceToolAtEnd = (process.env.VECTOR_ENFORCE_TOOL_AT_END || '0') === '1'

  while (useProvider && providerSelection && activeProvider) {
    const defaultMaxTurns = Number(process.env.VECTOR_MAX_TURNS || 4)
    const defaultAskTurns = Number(process.env.VECTOR_ASK_TURNS || 3)
    const maxTurns = Number(
      typeof input.maxTurns === 'number'
        ? input.maxTurns
        : input.mode === 'ask'
          ? defaultAskTurns
          : defaultMaxTurns,
    )
    if (!messages) {
      const plan = taskState.plan
      if (plan && Array.isArray(plan.steps) && plan.steps.length > 0) {
        const planContext = `PLAN_CONTEXT\n` +
          JSON.stringify({ steps: plan.steps, completed: plan.completed || [], currentIndex: plan.currentIndex ?? 0, notes: plan.notes || undefined })
        messages = [
          { role: 'user', content: planContext },
          { role: 'user', content: providerFirstMessage },
        ]
      } else {
        messages = [{ role: 'user', content: providerFirstMessage }]
      }
    }
    const convo = messages
    if (!convo) break
    const validationRetryLimit = 2
    const unknownToolRetryLimit = 1
    let unknownToolRetries = 0
    let consecutiveValidationErrors = 0

    requestAdditionalContext = (reason: string): boolean => {
      if (contextRequestsThisCall >= contextRequestLimit) return false
      contextRequestsThisCall += 1
      const ask = `CONTEXT_REQUEST ${reason}. Please fetch the relevant context (e.g., run get_active_script or list_selection) before continuing.`
      convo.push({ role: 'user', content: ask })
      appendHistory('system', ask)
      updateState((state) => {
        state.counters.contextRequests += 1
      })
      return true
    }

    let assistantFinalEmitted = false
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
          activeProvider === 'openai'
            ? process.env.OPENAI_TIMEOUT_MS || 30000
            : activeProvider === 'gemini'
              ? process.env.GEMINI_TIMEOUT_MS || process.env.OPENROUTER_TIMEOUT_MS || 30000
              : activeProvider === 'bedrock'
                ? process.env.BEDROCK_TIMEOUT_MS || process.env.OPENROUTER_TIMEOUT_MS || 30000
                : process.env.OPENROUTER_TIMEOUT_MS || 30000,
        )
        const resp = activeProvider === 'openai'
          ? await callOpenAI({
              systemPrompt: SYSTEM_PROMPT,
              messages: convo as any,
              model: providerSelection.model,
              apiKey: providerSelection.apiKey,
              baseUrl: providerSelection.baseUrl,
              timeoutMs,
            })
          : activeProvider === 'gemini'
            ? await callGemini({
                systemPrompt: SYSTEM_PROMPT,
                messages: convo as any,
                model: providerSelection.model,
                apiKey: providerSelection.apiKey,
                baseUrl: providerSelection.baseUrl,
                timeoutMs,
              })
            : activeProvider === 'bedrock'
              ? await callBedrock({
                  systemPrompt: SYSTEM_PROMPT,
                  messages: convo as any,
                  model: providerSelection.model,
                  apiKey: providerSelection.apiKey,
                  region: (providerSelection as any).region,
                  timeoutMs,
                })
              : activeProvider === 'nvidia'
              ? await callNvidia({
                  systemPrompt: SYSTEM_PROMPT,
                  messages: convo as any,
                  model: providerSelection.model,
                  apiKey: providerSelection.apiKey,
                  baseUrl: providerSelection.baseUrl,
                  deploymentId: (providerSelection as any).deploymentId,
                  timeoutMs,
                })
              : await callOpenRouter({
                  systemPrompt: SYSTEM_PROMPT,
                  messages: convo as any,
                  model: providerSelection.model,
                  apiKey: providerSelection.apiKey,
                  baseUrl: providerSelection.baseUrl,
                  timeoutMs,
                })
        content = resp.content || ''
        pushChunk(streamKey, `provider.response provider=${activeProvider} turn=${turn} chars=${content.length}`)
        console.log(`[orch] provider.ok provider=${activeProvider} turn=${turn} contentLen=${content.length}`)
        console.log('[orch] provider.raw', content)
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
        const rawText = content.trim()
        if (rawText.length > 0) {
          pushChunk(streamKey, 'assistant.raw ' + rawText)
        }
        // Enforce no-text-only turns: nudge to choose a tool or complete
        const hint = 'NO_TOOL_USED Please emit exactly one tool or call <complete><summary>…</summary></complete> to finish.'
        convo.push({ role: 'user', content: hint })
        appendHistory('system', hint)
        pushChunk(streamKey, 'error.validation no tool call parsed (nudged continue)')
        console.warn('[orch] parse.warn no tool call parsed; nudging to tool or complete')
        // Continue loop (do not break) unless provider was hard requested and keeps failing
        if (providerRequested) {
          // allow it to retry within the same loop
        }
        continue
      }

      const prefixText = (tool.prefixText || '').trim()
      if (allowTextBeforeTool && prefixText.length > 0) {
        pushChunk(streamKey, 'assistant.update ' + prefixText)
      }

      const suffixTextRaw = tool.suffixText || ''
      const suffixText = suffixTextRaw.trim()
      if (suffixText.length > 0) {
        if (enforceToolAtEnd) {
          const snippet = suffixText.slice(0, 160)
          console.warn(`[orch] parse.warn trailing text after tool: ${snippet}`)
          pushChunk(streamKey, 'warning.trailing_text ' + snippet)
          pushChunk(streamKey, 'metric.trailing_text 1')
        }
        if (allowTextBeforeTool) {
          pushChunk(streamKey, 'assistant.update ' + suffixText)
        }
      }

      const name = tool.name as keyof typeof Tools | string
      const toolName = String(name)
      let a: Record<string, any> = tool.args || {}

      // Normalize arguments for common flexible encodings
      if ((toolName === 'create_instance' || toolName === 'set_properties') && typeof (a as any).props === 'string') {
        const parsedProps = parseXmlObject(String((a as any).props))
        if (parsedProps && typeof parsedProps === 'object' && Object.keys(parsedProps).length > 0) {
          a = { ...a, props: parsedProps }
        }
      }
      if (toolName === 'list_children') {
        const cwRaw = (a as any).classWhitelist
        const cw = toClassWhitelist(cwRaw)
        if (cw) a = { ...a, classWhitelist: cw }
      }
      if (toolName === 'final_message') {
        if (!(a as any).text) {
          const alias = (a as any).result ?? (a as any).summary
          if (typeof alias === 'string') a = { ...a, text: alias }
          else if (typeof tool.innerRaw === 'string' && tool.innerRaw.trim().length > 0 && !/[<][a-zA-Z_]/.test(tool.innerRaw)) {
            a = { ...a, text: tool.innerRaw.trim() }
          }
        }
      }
      const toolXml = toXml(toolName, a)
      appendHistory('assistant', toolXml)
      pushChunk(streamKey, `tool.parsed ${toolName}`)
      console.log(`[orch] tool.parsed name=${toolName}`)

      const toolSchema = (Tools as any)[toolName as any] as z.ZodTypeAny | undefined
      if (!toolSchema) {
        unknownToolRetries++
        const errMsg = `Unknown tool: ${toolName}`
        pushChunk(streamKey, `error.validation ${errMsg}`)
        console.warn(`[orch] unknown.tool ${toolName}`)
        convo.push({ role: 'assistant', content: toolXml })
        const errorContent = `VALIDATION_ERROR ${toolName}\n${errMsg}`
        convo.push({ role: 'user', content: errorContent })
        appendHistory('system', errorContent)
        if (unknownToolRetries > unknownToolRetryLimit) break
        continue
      }

      const planReady = Array.isArray(taskState.plan?.steps) && (taskState.plan?.steps.length || 0) > 0
      const askMode = (input.mode || 'agent') === 'ask'
      const requirePlan = (process.env.VECTOR_REQUIRE_PLAN || '0') === '1'
      const isContextOrNonActionTool = (
        toolName === 'start_plan' ||
        toolName === 'update_plan' ||
        toolName === 'message' ||
        toolName === 'final_message' ||
        toolName === 'complete' ||
        toolName === 'attempt_completion' ||
        toolName === 'get_active_script' ||
        toolName === 'list_selection' ||
        toolName === 'list_open_documents' ||
        toolName === 'open_or_create_script' ||
        toolName === 'list_children' ||
        toolName === 'get_properties' ||
        toolName === 'list_code_definition_names' ||
        toolName === 'search_files'
      )
      const isActionTool = !isContextOrNonActionTool
      if (!planReady && isActionTool && !askMode && requirePlan) {
        const errMsg = 'PLAN_REQUIRED Call <start_plan> with a step-by-step outline before taking actions.'
        pushChunk(streamKey, `error.validation ${String(name)} plan_required`)
        console.warn(`[orch] plan.required tool=${String(name)}`)
        convo.push({ role: 'assistant', content: toolXml })
        convo.push({ role: 'user', content: errMsg })
        appendHistory('system', errMsg)
        continue
      }

  if ((name === 'show_diff' || name === 'apply_edit') && !a.path && input.context.activeScript?.path) {
    a = { ...a, path: input.context.activeScript.path }
  }
  if (name === 'show_diff' || name === 'apply_edit') {
    const filesRaw = Array.isArray((a as any).files) ? (a as any).files : undefined
    if (filesRaw) {
      const files = filesRaw.map((entry: any) => {
        if (!entry || typeof entry !== 'object') return entry
        const edits = normalizeEditsPayload((entry as any).edits)
        return edits ? { ...entry, edits } : entry
      })
      a = { ...a, files }
    }

    const normalizedEdits = normalizeEditsPayload((a as any).edits)
    if (normalizedEdits) {
      a = { ...a, edits: normalizedEdits }
    }
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

      if (toolSchema) {
        const parsed = toolSchema.safeParse(a)
        if (!parsed.success) {
          consecutiveValidationErrors++
          const errMsg = parsed.error?.errors?.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') || 'invalid arguments'
          pushChunk(streamKey, `error.validation ${String(name)} ${errMsg}`)
          console.warn(`[orch] validation.error tool=${String(name)} ${errMsg}`)
          const validationContent = `VALIDATION_ERROR ${String(name)}\n${errMsg}`
          convo.push({ role: 'assistant', content: toolXml })
          convo.push({ role: 'user', content: validationContent })
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

      if (name === 'search_assets' && !catalogSearchAvailable) {
        const errMsg = 'catalog_disabled Catalog search is unavailable. Create the requested objects manually using create_instance or Luau edits.'
        pushChunk(streamKey, `error.validation ${String(name)} catalog_disabled`)
        console.warn(`[orch] search_assets.disabled catalog unavailable; instructing manual creation`)
        convo.push({ role: 'assistant', content: toolXml })
        const validationContent = `VALIDATION_ERROR ${String(name)}\n${errMsg}`
        convo.push({ role: 'user', content: validationContent })
        appendHistory('system', validationContent)
        continue
      }

      const isContextTool =
        name === 'get_active_script' ||
        name === 'list_selection' ||
        name === 'list_open_documents' ||
        name === 'list_children' ||
        name === 'get_properties' ||
        name === 'list_code_definition_names' ||
        name === 'search_files'
      if (isContextTool) {
        let result: any
        if (name === 'get_active_script') {
          result = input.context.activeScript || null
        } else if (name === 'list_selection') {
          result = input.context.selection || []
        } else if (name === 'list_open_documents') {
          result = input.context.openDocs || []
        } else if (name === 'list_children') {
          const parentPath = typeof (a as any).parentPath === 'string' ? (a as any).parentPath : undefined
          if (!parentPath) {
            consecutiveValidationErrors++
            const errMsg = 'parentPath is required'
            pushChunk(streamKey, `error.validation ${String(name)} ${errMsg}`)
            console.warn(`[orch] validation.error tool=${String(name)} ${errMsg}`)
            const validationContent = `VALIDATION_ERROR ${String(name)}\n${errMsg}`
            convo.push({ role: 'assistant', content: toolXml })
            convo.push({ role: 'user', content: validationContent })
            appendHistory('system', validationContent)
            continue
          }
          const depth = typeof (a as any).depth === 'number' ? (a as any).depth : undefined
          const maxNodes = typeof (a as any).maxNodes === 'number' ? (a as any).maxNodes : undefined
          const classWhitelist = (a as any).classWhitelist && typeof (a as any).classWhitelist === 'object' && !Array.isArray((a as any).classWhitelist)
            ? (a as any).classWhitelist
            : undefined
          const inputObj: any = { parentPath, depth, maxNodes }
          if (classWhitelist) inputObj.classWhitelist = classWhitelist
          result = listSceneChildren(taskState, inputObj)
        } else if (name === 'get_properties') {
          const targetPath = typeof (a as any).path === 'string' ? (a as any).path : undefined
          if (!targetPath) {
            consecutiveValidationErrors++
            const errMsg = 'path is required'
            pushChunk(streamKey, `error.validation ${String(name)} ${errMsg}`)
            console.warn(`[orch] validation.error tool=${String(name)} ${errMsg}`)
            const validationContent = `VALIDATION_ERROR ${String(name)}\n${errMsg}`
            convo.push({ role: 'assistant', content: toolXml })
            convo.push({ role: 'user', content: validationContent })
            appendHistory('system', validationContent)
            continue
          }
          const keys = Array.isArray((a as any).keys) ? (a as any).keys.map(String) : undefined
          const includeAllAttributes = !!(a as any).includeAllAttributes
          result = getSceneProperties(taskState, { path: targetPath, keys }, includeAllAttributes)
        } else if (name === 'list_code_definition_names') {
          result = listCodeDefinitionNames(taskState.taskId, {
            root: typeof (a as any).root === 'string' ? (a as any).root : undefined,
            limit: typeof (a as any).limit === 'number' ? (a as any).limit : undefined,
            exts: Array.isArray((a as any).exts) ? (a as any).exts.map(String) : undefined,
          })
        } else {
          result = searchFiles({
            query: String((a as any).query ?? ''),
            root: typeof (a as any).root === 'string' ? (a as any).root : undefined,
            limit: typeof (a as any).limit === 'number' ? (a as any).limit : undefined,
            exts: Array.isArray((a as any).exts) ? (a as any).exts.map(String) : undefined,
            caseSensitive: !!(a as any).caseSensitive,
          })
        }

        const safeResult = name === 'get_active_script' && result && typeof (result as any).text === 'string'
          ? { ...(result as any), text: ((result as any).text as string).slice(0, 40000) }
          : result

        setLastTool(input.projectId, String(name), safeResult)
        pushChunk(streamKey, `tool.result ${String(name)}`)

        convo.push({ role: 'assistant', content: toolXml })
        const resultContent = `TOOL_RESULT ${String(name)}\n` + JSON.stringify(safeResult)
        convo.push({ role: 'user', content: resultContent })
        appendHistory('system', resultContent)
        updateState((state) => {
          const ts = Date.now()
          state.runs.push({ id: id('run'), tool: String(name), input: a, status: 'succeeded', startedAt: ts, endedAt: ts })
        })
        continue
      }

      const mapped = mapToolToProposals(String(name), a, input, msg, {
        getScriptSource,
        recordScriptSource,
        recordPlanStart,
        recordPlanUpdate,
        userOptedOut,
        geometryTracker,
      })

      if (mapped.contextResult !== undefined) {
        setLastTool(input.projectId, String(name), mapped.contextResult)
        pushChunk(streamKey, `tool.result ${String(name)}`)
        const resultContent = `TOOL_RESULT ${String(name)}\n` + JSON.stringify(mapped.contextResult)
        convo.push({ role: 'user', content: resultContent })
        appendHistory('system', resultContent)
        updateState((state) => {
          const ts = Date.now()
          state.runs.push({ id: id('run'), tool: String(name), input: a, status: 'succeeded', startedAt: ts, endedAt: ts })
        })
      }

      const touchesLuau = mapped.proposals.length > 0 && mapped.proposals.some(proposalTouchesLuau)
      const touchesGeometry = mapped.proposals.length > 0 && mapped.proposals.some(proposalTouchesGeometry)
      if (touchesLuau) {
        scriptWorkObserved = true
      }
      if (touchesGeometry) {
        geometryWorkObserved = true
      }

      const isFinalPhase =
        name === 'complete' ||
        name === 'final_message' ||
        name === 'attempt_completion' ||
        (name === 'message' && typeof (a as any).phase === 'string' && (a as any).phase.toLowerCase() === 'final')

      const scriptRequired = geometryWorkObserved && !scriptWorkObserved && !userOptedOut
      if (isFinalPhase && scriptRequired) {
        scriptWarnings += 1
        consecutiveValidationErrors += 1
        const warn =
          'SCRIPT_REQUIRED Default Script Policy: add Luau in a Script/ModuleScript (open_or_create_script → show_diff) that rebuilds the created Instances before completing. Say "geometry only" if you really need to skip.'
        pushChunk(streamKey, 'error.validation script_required')
        console.warn(`[orch] validation.script_missing tool=${String(name)}`)
        convo.push({ role: 'assistant', content: toolXml })
        convo.push({ role: 'user', content: warn })
        appendHistory('system', warn)
        if (consecutiveValidationErrors > validationRetryLimit || scriptWarnings > validationRetryLimit) break
        continue
      }

      if (mapped.proposals.length) {
        updateState((state) => {
          const policy = ensureScriptPolicy(state)
          if (touchesGeometry) {
            policy.geometryOps += 1
          }
          if (touchesLuau) {
            policy.luauEdits += 1
          }
          for (const proposal of mapped.proposals) {
            if (proposal.type === 'object_op') {
              applyObjectOpsPreview(state, proposal.ops)
            }
          }
        })
        pushChunk(streamKey, `proposals.mapped ${String(name)} count=${mapped.proposals.length}`)
        console.log(`[orch] proposals.mapped tool=${String(name)} count=${mapped.proposals.length}`)
        // Stream assistant text for UI transcript
        if (String(name) === 'final_message') {
          const text = typeof (a as any).text === 'string' ? (a as any).text : undefined
          if (text && text.trim().length > 0) {
            if (!assistantFinalEmitted) pushChunk(streamKey, 'assistant.final ' + text)
            assistantFinalEmitted = true
          }
        }
        if (String(name) === 'message') {
          const text = typeof (a as any).text === 'string' ? (a as any).text : undefined
          const phase = typeof (a as any).phase === 'string' ? (a as any).phase : 'update'
          if (text && text.trim().length > 0) {
            pushChunk(streamKey, `assistant.${phase} ` + text)
            if (phase === 'final') assistantFinalEmitted = true
          }
        }
        if (String(name) === 'complete') {
          const text = typeof (a as any).summary === 'string' ? (a as any).summary : undefined
          if (text && text.trim().length > 0 && !assistantFinalEmitted) {
            pushChunk(streamKey, 'assistant.final ' + text)
            assistantFinalEmitted = true
          }
        }
        if (String(name) === 'attempt_completion') {
          const text = typeof (a as any).result === 'string' ? (a as any).result : undefined
          if (text && text.trim().length > 0 && !assistantFinalEmitted) {
            pushChunk(streamKey, 'assistant.final ' + text)
            assistantFinalEmitted = true
          }
        }
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
        convo.push({ role: 'assistant', content: toolXml })
        const errorContent = `VALIDATION_ERROR ${String(name)}\n${errMsg}`
        convo.push({ role: 'user', content: errorContent })
        appendHistory('system', errorContent)
        if (unknownToolRetries > unknownToolRetryLimit) break
        continue
      }

      if (mapped.contextResult !== undefined) {
        continue
      }

      break
    }

    if (!fallbacksDisabled && !assetFallbackWarningSent) {
      const warn = 'CATALOG_UNAVAILABLE Asset catalog lookup failed. Create the requested objects manually using create_instance or Luau edits.'
      pushChunk(streamKey, 'fallback.asset manual_required')
      console.log('[orch] fallback.asset manual_required; instructing provider to create manually')
      appendHistory('assistant', 'fallback: asset search disabled (request manual creation)')
      convo.push({ role: 'user', content: warn })
      appendHistory('system', warn)
      assetFallbackWarningSent = true
      continue
    }

    break
  }
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
    const errMsg = 'ASSET_FALLBACK_DISABLED Asset catalog fallback is disabled. Create the requested objects manually using create_instance or Luau edits.'
    pushChunk(streamKey, 'fallback.asset disabled')
    console.warn('[orch] fallback.asset disabled; no proposals after provider warning')
    appendHistory('system', errMsg)
    throw new Error('Asset fallback disabled; manual creation required')
  }
  throw new Error('No actionable tool produced within turn limit')
}
