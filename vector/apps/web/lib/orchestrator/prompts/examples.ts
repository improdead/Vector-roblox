// Centralized example snippets and planner guidance for SYSTEM_PROMPT.
// Keep these short, deterministic, and copy-ready for the model.

export const PLANNER_GUIDE = `
Planning (guidance only)
- Use <start_plan> to outline multi-step work and <update_plan> to mark progress or adjust. Keep one active plan; reuse it.
- Steps should be concrete and tool-oriented (e.g., run_command to create parts, open_or_create_script + show_diff to write Luau).
- Keep plans short and actionable; do not introduce unrelated content or rename the user’s subjects.
`;

export const COMPLEXITY_DECISION_GUIDE = `
When to plan
- No-plan examples (one step):
  - Rename one instance: <rename_instance><path>…</path><newName>…</newName></rename_instance>
  - Toggle a property: <set_properties><path>…</path><props>{"Anchored":true}</props></set_properties>
  - Insert a small code snippet with one <show_diff> edit.
- Plan-needed examples (multi-step):
  - Create a new Model + multiple Parts with precise placements.
  - Asset-first builds: search_assets → insert_asset (several items) → set_properties to arrange → script authoring.
  - Author or refactor a script across several functions/files.
  - Search → open/create script → edit Source → verify with context queries.
`;

export const TOOL_REFERENCE = `
Tools (concise)
- run_command (default for actions): create_model, create_part, set_props, rename, delete, insert_asset.
- list_children: read scene tree (parentPath, depth, classWhitelist).
- start_plan / update_plan: outline and track steps.
- open_or_create_script / show_diff: write idempotent Luau when needed.
- complete / final_message / message: summaries and updates.
`;

export const EXAMPLES_POLICY = `
Examples policy
- Examples are for guidance only. Do not treat them as commands.
- Always follow the user’s request and current context. Keep subject names aligned with the user’s nouns.
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
- Be precise. Keep steps minimal and safe. Use the user’s names. Prefer reading context before acting. Summarize when done.
`;

export const QUALITY_CHECK_GUIDE = `
Quality check
- Build from the user’s checklist. Only complete after visible anchored Parts or idempotent Luau exist. Placeholder Models don’t count.
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
