# Testing Framework Implementation Review

## Critical Issues Found

After reviewing the actual Vector agent implementation, I've identified **fundamental mismatches** between the testing framework and how Vector actually works.

### Issue 1: Wrong API Response Format ❌

**What I Implemented:**
```typescript
// agent-executor.ts lines 153-179
// Tries to parse STREAMING SSE response with types like:
{ type: 'status', message: '...' }
{ type: 'tool', tool: '...', params: {...} }
{ type: 'proposal', proposal: {...} }
{ type: 'text', text: '...' }
{ type: 'done' }
```

**What Vector Actually Does:**
```typescript
// /api/chat/route.ts line 90
// Returns DIRECT JSON response:
{
  workflowId: string,
  proposals: Proposal[],  // Already processed!
  taskState: TaskState,
  tokenTotals: {...},
  isComplete: boolean
}
```

**Impact:** The agent executor will fail immediately because it tries to read streaming data from a JSON response.

---

### Issue 2: Misunderstanding Tool Calls ❌

**What I Assumed:**
- Tool calls are events streamed during execution
- We need to track each individual tool call
- Tool calls come with timestamps and durations

**What Actually Happens:**
1. Agent sends **XML-formatted tool requests** to LLM (e.g., `<create_instance>...</create_instance>`)
2. Orchestrator **parses XML** and converts to **proposals**
3. API returns **proposals**, not raw tool calls
4. Proposals are **already processed** (edit diffs generated, validation done, etc.)

**Example from system prompt (lines 362-368):**
```xml
<tool_name>
  <param>...</param>
</tool_name>
```

**Impact:** Tests can't verify individual tool calls because they're abstracted into proposals.

---

### Issue 3: Missing Context Format Understanding ❌

**What Vector Expects (from ChatSchema in api/chat/route.ts):**
```typescript
context: {
  activeScript?: { path: string, text: string } | null,
  selection?: Array<{ className: string, path: string }>,
  openDocs?: Array<{ path: string }>,
  scene?: {
    nodes?: Array<{
      path: string,
      className: string,
      name: string,
      parentPath?: string,
      props?: Record<string, any>
    }>
  },
  codeDefinitions?: Array<{ file: string, line: number, name: string }>
}
```

**What I Implemented:**
```typescript
// virtual-env.ts getContext()
// Returns different format - missing codeDefinitions,
// different structure for scene nodes
```

**Impact:** Context sent to API may be rejected or misinterpreted.

---

### Issue 4: Wrong Proposal Application Logic ❌

**Proposal Types from orchestrator/index.ts:**

1. **EditProposal**
   ```typescript
   {
     type: 'edit',
     files: [{
       path: string,
       diff: { mode: 'rangeEDITS', edits: Edit[] },
       preview: { unified?, before?, after? },
       safety: { beforeHash?, baseText?, anchors? }
     }]
   }
   ```

2. **ObjectProposal**
   ```typescript
   {
     type: 'object_op',
     ops: [
       { op: 'create_instance', className, parentPath, props? } |
       { op: 'set_properties', path, props } |
       { op: 'rename_instance', path, newName } |
       { op: 'delete_instance', path }
     ]
   }
   ```

3. **AssetProposal**
   ```typescript
   {
     type: 'asset_op',
     search?: { query, tags?, limit? },
     insert?: { assetId, parentPath? },
     generate3d?: { prompt, tags?, style?, budget? }
   }
   ```

4. **CompletionProposal**
   ```typescript
   {
     type: 'completion',
     summary: string,
     confidence?: number
   }
   ```

**What My Code Does:**
```typescript
// agent-executor.ts applyProposal()
// Only handles single tool names, not proposal formats
switch (tool) {  // WRONG - should be proposal.type
  case 'apply_edit': ...
  case 'create_instance': ...
}
```

**Impact:** Proposals won't be applied correctly to virtual environment.

---

### Issue 5: No Integration with Agent's Planning/Logic ❌

**Vector's Multi-Turn Flow:**
1. User sends message
2. Agent may use **context tools** first: `get_active_script`, `list_selection`, `list_children`, `get_properties`
3. Agent creates **plan** with `<start_plan>` (required for non-trivial tasks)
4. Agent emits **action tools** one at a time
5. Each action becomes a **proposal**
6. If script policy active, agent **must** write Luau before `<complete>`

**From system prompt lines 355-360:**
> "For non-trivial tasks, your <start_plan> MUST list detailed, tool-specific steps"
> "Default Script Policy: whenever you create/modify Instances, you must author Luau that rebuilds the result before completing"

**What Tests Actually Verify:**
- ❌ No verification of planning quality
- ❌ No verification of script policy compliance
- ❌ No verification of multi-turn context gathering
- ❌ No verification of idempotent Luau generation

**Impact:** Tests miss the agent's actual intelligence and reasoning.

---

## How Vector Really Works

### 1. API Flow (Correct)
```
Plugin → POST /api/chat {
  projectId, message, context, mode?, modelOverride?
}
↓
Orchestrator runLLM() {
  - Determines provider (OpenRouter/Gemini/Bedrock/NVIDIA)
  - Sends system prompt + user message
  - LLM responds with XML tool calls
  - Parses XML → converts to proposals
  - Multi-turn loop for context tools
  - Returns proposals
}
↓
API Response {
  workflowId,
  proposals: [EditProposal | ObjectProposal | AssetProposal | CompletionProposal],
  taskState,
  isComplete
}
```

### 2. System Prompt Structure
- **Core rules**: One tool per turn, proposal-first, plan for multi-step
- **Planning**: `<start_plan>` with 8-15 detailed steps
- **Script policy**: Must write Luau for any geometry changes (unless opt-out)
- **Tool format**: XML tags with JSON params
- **Quality checks**: Derive checklist, track progress, verify completion

### 3. What Should Be Tested

**Functional Tests (What I Tried):**
- ✅ Can create instances
- ✅ Can set properties
- ✅ Can apply edits
- ❌ But these are TOO LOW-LEVEL

**Intelligence/Reasoning Tests (What's Missing):**
- Does agent **plan** before acting?
- Does agent **inspect scene** with `list_children` before creating?
- Does agent **avoid duplicates**?
- Does agent **write idempotent Luau** after geometry?
- Does agent **follow script policy**?
- Does agent **use assets** vs manual geometry?
- Does agent **handle errors** and retry?

---

## Correct Implementation Approach

### 1. Fix Agent Executor

```typescript
async execute(prompt: string): Promise<ExecutionResult> {
  // Get context
  const context = this.env.getContext();

  // Call API
  const response = await fetch(`${this.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: 'test-env',
      message: prompt,
      context,
      mode: 'agent'
    })
  });

  // Parse JSON (NOT streaming)
  const data = await response.json();
  // { workflowId, proposals, taskState, tokenTotals, isComplete }

  // Apply proposals
  for (const proposal of data.proposals) {
    await this.applyProposal(proposal);
  }

  // Return result
  return {
    proposals: data.proposals,
    taskState: data.taskState,
    isComplete: data.isComplete,
    ...
  };
}
```

### 2. Fix Proposal Application

```typescript
private async applyProposal(proposal: Proposal) {
  switch (proposal.type) {
    case 'edit':
      // Apply each file change
      for (const file of proposal.files) {
        this.env.updateFile(file.path, this.applyRangeEdits(
          this.env.getFile(file.path)?.content || '',
          file.diff.edits
        ));
      }
      break;

    case 'object_op':
      // Apply each operation
      for (const op of proposal.ops) {
        switch (op.op) {
          case 'create_instance':
            this.env.createInstance(op.parentPath, op.className, ...);
            break;
          case 'set_properties':
            this.env.setProperties(op.path, op.props);
            break;
          // ...
        }
      }
      break;

    case 'asset_op':
      if (proposal.insert) {
        // Simulate asset insertion
        this.env.createInstance(
          proposal.insert.parentPath || 'game.Workspace',
          'Model',
          `Asset_${proposal.insert.assetId}`
        );
      }
      break;

    case 'completion':
      // Just track completion
      break;
  }
}
```

### 3. Fix Context Generation

```typescript
getContext() {
  return {
    activeScript: this.activeScript ? {
      path: this.activeScript,
      text: this.files.get(this.activeScript)?.content || ''
    } : null,

    selection: this.selection.map(path => ({
      className: this.instances.get(path)?.className || 'Instance',
      path
    })),

    openDocs: Array.from(this.files.keys()).map(path => ({ path })),

    scene: {
      nodes: Array.from(this.instances.values()).map(inst => ({
        path: inst.path,
        className: inst.className,
        name: inst.name,
        parentPath: inst.parent || undefined,
        props: inst.properties
      }))
    },

    codeDefinitions: [] // Optional
  };
}
```

### 4. Better Test Scenarios

```typescript
{
  name: 'Agent Plans Before Acting',
  prompt: 'Build a watch tower',
  verify: (result) => {
    // Check that first proposal is planning
    const hasStartPlan = result.taskState?.plan?.steps?.length > 0;

    // Check plan mentions asset search
    const planMentionsAssets =
      result.taskState?.plan?.steps?.some(s =>
        s.includes('search') || s.includes('asset')
      );

    return {
      passed: hasStartPlan && planMentionsAssets,
      errors: [
        !hasStartPlan && 'Agent did not create plan',
        !planMentionsAssets && 'Plan does not mention asset search'
      ].filter(Boolean)
    };
  }
},

{
  name: 'Agent Writes Idempotent Luau',
  prompt: 'Create a red part at position (10, 5, 0)',
  verify: (result) => {
    // Check geometry created
    const hasGeometry = result.proposals.some(p =>
      p.type === 'object_op' &&
      p.ops.some(op => op.op === 'create_instance')
    );

    // Check Luau written
    const hasScript = result.proposals.some(p =>
      p.type === 'edit'
    );

    // Check script is idempotent (checks for existing)
    const scriptContent = result.finalState.files.find(
      f => f[0].includes('Script')
    )?.[1]?.content || '';
    const hasIdempotency =
      scriptContent.includes('FindFirstChild') ||
      scriptContent.includes(':FindFirst') ||
      scriptContent.includes('if not ');

    return {
      passed: hasGeometry && hasScript && hasIdempotency,
      errors: [
        !hasGeometry && 'No geometry created',
        !hasScript && 'No script written (violates script policy)',
        !hasIdempotency && 'Script not idempotent'
      ].filter(Boolean)
    };
  }
}
```

---

## Recommended Actions

### Immediate (Before Testing):

1. **Rewrite agent-executor.ts**
   - Remove streaming logic
   - Parse JSON response directly
   - Fix proposal application to match actual types
   - Add proper range edit application

2. **Fix virtual-env.ts**
   - Update `getContext()` to match exact API schema
   - Add `codeDefinitions` support
   - Match scene node format exactly

3. **Rewrite test scenarios**
   - Focus on **agent reasoning**, not just mechanics
   - Test planning behavior
   - Test script policy compliance
   - Test asset-first approach
   - Test idempotent code generation

4. **Add tool result tracking**
   - Parse taskState to see what tools were used
   - Verify multi-turn context gathering
   - Check planning steps

### Testing Priority:

**High Value (Test Agent Intelligence):**
1. Does agent plan multi-step tasks?
2. Does agent inspect scene before creating?
3. Does agent write scripts after geometry?
4. Does agent prefer assets over manual geometry?
5. Does agent avoid duplicates?

**Lower Value (Mechanics Already Tested in Plugin):**
1. Can create instances
2. Can set properties
3. Can apply edits

---

## Current Status

❌ **Testing framework is NOT ready**
- Wrong API integration
- Wrong proposal handling
- Wrong context format
- Missing intelligence testing
- Will fail on first API call

🔧 **Needs complete rewrite of:**
- `agent-executor.ts` (API integration)
- `virtual-env.ts` (context generation)
- `scenario-tests.ts` (test logic)
- `tool-tests.ts` (test design)

⏱️ **Estimate:** 2-3 hours to fix properly

---

## Questions for You

1. **Do you want me to fix these issues now?**
   - I can rewrite the core modules correctly

2. **What's most important to test?**
   - Agent's planning/reasoning quality?
   - Compliance with script policy?
   - Asset-first behavior?
   - Code quality (idempotent, anchored, etc.)?

3. **Should tests verify LLM behavior or just mechanics?**
   - Current tests check "did it create instance" (mechanics)
   - Better tests check "did it plan first, search assets, write script" (intelligence)

4. **Do you have .env configured with API keys?**
   - Need ANTHROPIC_API_KEY or OPENAI_API_KEY or OPENROUTER_API_KEY
   - Which provider should tests use?

Please let me know how you want to proceed. The framework structure is good, but the implementation details are wrong.
