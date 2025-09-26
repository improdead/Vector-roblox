import { z } from 'zod'

// Helper: tolerate models that wrap JSON objects as strings
const JsonObjectFromString = z
  .string()
  .transform((s) => {
    try {
      const v = JSON.parse(s)
      return typeof v === 'object' && v !== null ? v : {}
    } catch {
      return {}
    }
  })

export const EditRange = z.object({ line: z.number(), character: z.number() })
export const Edit = z.object({ start: EditRange, end: EditRange, text: z.string() })

const ParentEither = z
  .object({ parentPath: z.string() })
  .or(z.object({ parent: z.string() }))
  .transform((v) => ('parentPath' in v ? v : { parentPath: (v as any).parent }))

export const Tools = {
  get_active_script: z.object({}),
  list_selection: z.object({}),
  list_open_documents: z.object({ maxCount: z.number().min(1).max(100).optional() }),
  open_or_create_script: z
    .object({
      path: z.string().min(1).optional(),
      parentPath: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
    })
    .superRefine((value, ctx) => {
      if (!value.path && !(value.parentPath && value.name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide path or (parentPath + name)' })
      }
    }),
  start_plan: z.object({
    steps: z.array(z.string()).min(1),
  }),
  update_plan: z.object({
    completedStep: z.string().optional(),
    nextStep: z.string().optional(),
    notes: z.string().optional(),
  }),
  // Scene/context discovery helpers (Roblox plugin-backed)
  list_children: z.object({
    parentPath: z.string(),
    depth: z.number().min(0).max(10).optional(),
    maxNodes: z.number().min(1).max(2000).optional(),
    // Accept a simple record like { "Part": true, "Model": true }
    classWhitelist: z.record(z.boolean()).optional(),
  }),
  get_properties: z.object({
    path: z.string(),
    keys: z.array(z.string()).optional(),
    includeAllAttributes: z.boolean().optional(),
    maxBytes: z.number().min(1).max(1_000_000).optional(),
  }),
  show_diff: z.object({ path: z.string(), edits: z.array(Edit) }),
  apply_edit: z.object({ path: z.string(), edits: z.array(Edit) }),
  create_instance: z
    .object({
      className: z.string(),
      // props can be a proper object or a stringified JSON object
      props: z.union([z.record(z.any()), JsonObjectFromString]).optional(),
    })
    .and(ParentEither),
  set_properties: z.object({ path: z.string(), props: z.union([z.record(z.any()), JsonObjectFromString]) }),
  rename_instance: z.object({ path: z.string(), newName: z.string() }),
  delete_instance: z.object({ path: z.string() }),
  search_assets: z.object({ query: z.string(), tags: z.array(z.string()).optional(), limit: z.number().min(1).max(50).optional() }),
  insert_asset: z.object({ assetId: z.number(), parentPath: z.string().optional() }),
  generate_asset_3d: z.object({ prompt: z.string(), tags: z.array(z.string()).optional(), style: z.string().optional(), budget: z.number().optional() }),
  list_code_definition_names: z.object({
    root: z.string().optional(),
    limit: z.number().min(1).max(1000).optional(),
    exts: z.array(z.string()).optional(),
  }),
  search_files: z.object({
    query: z.string().min(1),
    root: z.string().optional(),
    limit: z.number().min(1).max(100).optional(),
    exts: z.array(z.string()).optional(),
    caseSensitive: z.boolean().optional(),
  }),
  // Explicit completion tools (Cline-style)
  // Preferred
  complete: z.object({
    summary: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
  }),
  // Ask-mode friendly final message for UI transcript (optional)
  final_message: z.object({
    text: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
  }),
  // Streaming-style message with a phase (start|update|final)
  message: z.object({
    text: z.string().min(1),
    phase: z.enum(['start', 'update', 'final']).optional(),
  }),
  // Alias for compatibility with Cline terminology
  attempt_completion: z.object({
    result: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
  }),
}
export type ToolsShape = typeof Tools
