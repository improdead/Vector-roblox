// Centralized example snippets and planner guidance for SYSTEM_PROMPT.
// Keep these short, deterministic, and copy-ready for the model.

export const PLANNER_GUIDE = `
Planning
- Translate the user's request into concrete build goals (shell, details, styling, behaviors).
- Decide if planning is needed:
  - Skip planning for a single, obvious action (e.g., rename, toggle Anchored, one small show_diff).
  - Use planning when multi-step, ambiguous, or cross-file/scene changes are involved.
- If planning, call <start_plan> with an ordered list of short, actionable steps.
- Keep each step to a single tool (create_instance, set_properties, show_diff, etc.).
- Use <update_plan> as you progress (mark completed steps, note discoveries, add the next target).
- Start with container Models, add geometry with create_instance, then refine using set_properties.
- Revisit and adjust the plan as new context arrives; surface key updates with <message> when useful.
`;

export const COMPLEXITY_DECISION_GUIDE = `
When to plan
- No-plan examples (one step):
  - Rename one instance: <rename_instance><path>…</path><newName>…</newName></rename_instance>
  - Toggle a property: <set_properties><path>…</path><props>{"Anchored":true}</props></set_properties>
  - Insert a small code snippet with one <show_diff> edit.
- Plan-needed examples (multi-step):
  - Create a new Model + multiple Parts with precise placements.
  - Author or refactor a script across several functions/files.
  - Search → open/create script → edit Source → verify with context queries.
`;

export const TOOL_REFERENCE = `
Tool reference (purpose and tips)
- start_plan: Begin an ordered list of steps. Use for multi-step work.
- update_plan: Mark a step done, set next step, or add notes.
- get_active_script: Return the currently open script (path, text) if any.
- list_selection: Return the current Studio selection (array of paths/classes).
- list_open_documents: Return open documents; useful to infer likely targets.
- open_or_create_script: Ensure a Script/LocalScript/ModuleScript exists; returns {path,text,created}.
- list_children: Inspect scene tree under a path. Add classWhitelist to filter.
- get_properties: Read properties/attributes for a path; set includeAllAttributes for attributes.
- list_code_definition_names: Enumerate known code symbol names for navigation.
- search_files: Grep-like substring search across files (case-insensitive by default).
- show_diff: Propose edits to a file. Prefer first before apply_edit. Supports <files>[…] for multi-file.
- apply_edit: Apply edits directly (use sparingly; prefer show_diff previews first).
- create_instance: Create a Roblox instance at parentPath with optional props.
- set_properties: Update properties on an existing instance.
- rename_instance: Rename an instance at a path.
- delete_instance: Delete an instance.
- search_assets: Search catalog for assets (limit ≤ 6 unless asked otherwise).
- insert_asset: Insert an assetId into the scene (defaults to game.Workspace).
- generate_asset_3d: Request a generated asset; include tags/style/budget if helpful.
- complete: Mark the task complete with a succinct summary.
- message: Stream a short text update with phase=start|update|final.
- final_message: Send the final summary (Ask-friendly) and end the turn.
- attempt_completion: Alias for completion; include result and optional confidence.
`;

export const WORKFLOW_EXAMPLES = `
Examples by task type

Small, single change (no plan)
<set_properties>
  <path>game.Workspace.MyPart</path>
  <props>{"Anchored":true}</props>
</set_properties>

Quick code tweak (no plan)
<show_diff>
  <path>game.Workspace.Script</path>
  <edits>[{"start":{"line":0,"character":0},"end":{"line":0,"character":0},"text":"-- Debug header\\n"}]</edits>
</show_diff>

Create script if missing (planned)
<start_plan>
  <steps>["Ensure target script exists","Insert initialization block"]</steps>
</start_plan>
<open_or_create_script>
  <parentPath>game.ServerScriptService</parentPath>
  <name>Init</name>
</open_or_create_script>
<show_diff>
  <path>game.ServerScriptService.Init</path>
  <edits>[{"start":{"line":0,"character":0},"end":{"line":0,"character":0},"text":"print(\"Init loaded\")\n"}]</edits>
</show_diff>

Multi-file refactor (planned)
<start_plan>
  <steps>["Locate target functions","Edit both modules","Summarize changes"]</steps>
</start_plan>
<search_files>
  <query>function doWork</query>
</search_files>
<show_diff>
  <files>[
    {"path":"game.ReplicatedStorage.ModuleA","edits":[{"start":{"line":10,"character":0},"end":{"line":12,"character":0},"text":"-- updated A\n"}]},
    {"path":"game.ReplicatedStorage.ModuleB","edits":[{"start":{"line":5,"character":0},"end":{"line":7,"character":0},"text":"-- updated B\n"}]}
  ]</files>
</show_diff>

Asset search and insert (planned)
<start_plan>
  <steps>["Search low-poly tree","Insert into scene"]</steps>
</start_plan>
<search_assets>
  <query>low poly tree</query>
  <limit>3</limit>
</search_assets>
<insert_asset>
  <assetId>123456789</assetId>
  <parentPath>game.Workspace.Terrain</parentPath>
</insert_asset>
`;

export const ROLE_SCOPE_GUIDE = `
Role and approach
- Be a precise, safety-first Roblox Studio copilot.
- Favor minimal, reviewable steps with previews (show_diff/object ops).
- Use the user's existing names/styles when extending code or scenes.
- Prefer reading context (selection, open docs, search) before guessing paths.
- Avoid destructive changes; never delete or overwrite large files blindly.
- Summarize outcomes with complete/attempt_completion or final_message when done.
`;

export const QUALITY_CHECK_GUIDE = `
Quality check
- Derive a checklist of deliverables straight from the prompt (e.g., floor, four walls, roof).
- Track completion of each checklist item as you work; optionally stream progress updates.
- Only call <complete> once every checklist item is satisfied with visible, anchored geometry or verified code.
- Placeholder Models or unattached Parts never count toward completion.
- Ensure reproducible Luau exists: update a Script/ModuleScript (or repo .lua/.luau file) so the build can be rebuilt from code before completing.
- Use open_or_create_script(path,parentPath?,name?) to guarantee a script container exists before diffing or editing its Source.
`;

export const EXAMPLE_HOUSE_SMALL = `
<create_instance>
  <className>Model</className>
  <parentPath>game.Workspace</parentPath>
  <props>{"Name":"House"}</props>
</create_instance>

<create_instance>
  <className>Part</className>
  <parentPath>game.Workspace.House</parentPath>
  <props>{"Name":"House_Floor","Anchored":true,"Material":{"__t":"EnumItem","enum":"Enum.Material","name":"Concrete"},"Size":{"__t":"Vector3","x":16,"y":1,"z":16},"CFrame":{"__t":"CFrame","comps":[0,0.5,0, 1,0,0, 0,1,0, 0,0,1]}}</props>
</create_instance>

<create_instance>
  <className>Part</className>
  <parentPath>game.Workspace.House</parentPath>
  <props>{"Name":"House_Wall_Back","Anchored":true,"Material":{"__t":"EnumItem","enum":"Enum.Material","name":"Brick"},"Size":{"__t":"Vector3","x":16,"y":8,"z":1},"CFrame":{"__t":"CFrame","comps":[0,4.5,-8, 1,0,0, 0,1,0, 0,0,1]}}</props>
</create_instance>

<create_instance>
  <className>Part</className>
  <parentPath>game.Workspace.House</parentPath>
  <props>{"Name":"House_Wall_Front","Anchored":true,"Material":{"__t":"EnumItem","enum":"Enum.Material","name":"Brick"},"Size":{"__t":"Vector3","x":16,"y":8,"z":1},"CFrame":{"__t":"CFrame","comps":[0,4.5,8, 1,0,0, 0,1,0, 0,0,1]}}</props>
</create_instance>

<create_instance>
  <className>Part</className>
  <parentPath>game.Workspace.House</parentPath>
  <props>{"Name":"House_Wall_Left","Anchored":true,"Material":{"__t":"EnumItem","enum":"Enum.Material","name":"Brick"},"Size":{"__t":"Vector3","x":1,"y":8,"z":16},"CFrame":{"__t":"CFrame","comps":[-8,4.5,0, 1,0,0, 0,1,0, 0,0,1]}}</props>
</create_instance>

<create_instance>
  <className>Part</className>
  <parentPath>game.Workspace.House</parentPath>
  <props>{"Name":"House_Wall_Right","Anchored":true,"Material":{"__t":"EnumItem","enum":"Enum.Material","name":"Brick"},"Size":{"__t":"Vector3","x":1,"y":8,"z":16},"CFrame":{"__t":"CFrame","comps":[8,4.5,0, 1,0,0, 0,1,0, 0,0,1]}}</props>
</create_instance>

<create_instance>
  <className>Part</className>
  <parentPath>game.Workspace.House</parentPath>
  <props>{"Name":"House_Roof","Anchored":true,"Material":{"__t":"EnumItem","enum":"Enum.Material","name":"Slate"},"Size":{"__t":"Vector3","x":18,"y":1,"z":18},"CFrame":{"__t":"CFrame","comps":[0,9,0, 1,0,0, 0,1,0, 0,0,1]}}</props>
</create_instance>`;

export const EXAMPLE_VEHICLE_CART = `
<create_instance>
  <className>Model</className>
  <parentPath>game.Workspace</parentPath>
  <props>{"Name":"Cart"}</props>
</create_instance>

<create_instance>
  <className>Part</className>
  <parentPath>game.Workspace.Cart</parentPath>
  <props>{"Name":"Cart_Chassis","Anchored":true,"Material":{"__t":"EnumItem","enum":"Enum.Material","name":"Metal"},"Size":{"__t":"Vector3","x":10,"y":1,"z":6},"CFrame":{"__t":"CFrame","comps":[0,1,0, 1,0,0, 0,1,0, 0,0,1]}}</props>
</create_instance>

<create_instance>
  <className>Part</className>
  <parentPath>game.Workspace.Cart</parentPath>
  <props>{"Name":"Cart_Wheel_1","Shape":{"__t":"EnumItem","enum":"Enum.PartType","name":"Ball"},"Anchored":true,"Material":{"__t":"EnumItem","enum":"Enum.Material","name":"Plastic"},"Size":{"__t":"Vector3","x":2,"y":2,"z":2},"CFrame":{"__t":"CFrame","comps":[4,0.5,3, 1,0,0, 0,1,0, 0,0,1]}}</props>
</create_instance>`;

export const EXAMPLE_FARM_SCRIPT = `
<start_plan>
  <steps>["Ensure Farm model exists","Author FarmBuilder script","Script creates base and plots"]</steps>
</start_plan>

<open_or_create_script>
  <parentPath>game.ServerScriptService</parentPath>
  <name>FarmBuilder</name>
</open_or_create_script>

<show_diff>
  <path>game.ServerScriptService.FarmBuilder</path>
  <edits>[{"start":{"line":0,"character":0},"end":{"line":0,"character":0},"text":"local Workspace = game:GetService(\"Workspace\")\nlocal function ensureModel(name)\n\tlocal model = Workspace:FindFirstChild(name)\n\tif not model then\n\t\tmodel = Instance.new(\"Model\")\n\t\tmodel.Name = name\n\t\tmodel.Parent = Workspace\n\tend\n\treturn model\nend\n\nlocal function ensurePart(parent, name, size, cf, material)\n\tlocal part = parent:FindFirstChild(name)\n\tif not part then\n\t\tpart = Instance.new(\"Part\")\n\t\tpart.Anchored = true\n\t\tpart.Name = name\n\t\tpart.Parent = parent\n\tend\n\tpart.Size = size\n\tpart.CFrame = cf\n\tpart.Material = material or Enum.Material.Ground\n\treturn part\nend\n\nlocal farm = ensureModel(\"Farm\")\nensurePart(farm, \"Farm_Base\", Vector3.new(40, 1, 40), CFrame.new(0, 0.5, 0), Enum.Material.Grass)\nlocal offsets = {-12, -4, 4, 12}\nlocal index = 1\nfor _, x in ipairs(offsets) do\n\tfor _, z in ipairs(offsets) do\n\t\tif index > 9 then break end\n\t\tensurePart(farm, string.format(\"Farm_Plot_%02d\", index), Vector3.new(6, 0.2, 6), CFrame.new(x, 0.6, z))\n\t\tindex += 1\n\tend\n\tif index > 9 then break end\nend\n"}]</edits>
</show_diff>

<update_plan>
  <completedStep>Author FarmBuilder script</completedStep>
  <nextStep>Script creates base and plots</nextStep>
</update_plan>`;
