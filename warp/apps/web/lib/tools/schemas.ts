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
  list_open_documents: z.object({}),
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
}
export type ToolsShape = typeof Tools
