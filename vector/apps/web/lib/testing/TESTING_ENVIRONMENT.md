# Vector Agent Testing Environment

**Version:** 2.0
**Created:** 2025-11-09
**Purpose:** Automated test runner for Vector agent with virtual Roblox environment

---

## Overview

### What This Is

An **automated testing framework** that:
- Simulates a Roblox Studio environment in-memory
- Runs agent prompts with auto-approval
- Captures all tool calls, code generation, and state changes
- Outputs detailed logs and reports for review
- Tests individual tools + real-world scenarios

### What This Is NOT

- ❌ Not a UI/playground
- ❌ Not manual testing
- ❌ Not a replacement for the plugin

### Use Cases

✅ Test agent capabilities without Studio
✅ Verify tool calls work correctly
✅ Review generated code quality
✅ Debug agent logic step-by-step
✅ Regression testing for changes
✅ Performance benchmarking

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Test Runner (CLI)                         │
└───────────────────────┬─────────────────────────────────────┘
                        │
         ┌──────────────┴──────────────┐
         │                             │
    ┌────▼─────┐                 ┌────▼─────┐
    │ Tool     │                 │ Scenario │
    │ Tests    │                 │ Tests    │
    └────┬─────┘                 └────┬─────┘
         │                             │
         └──────────────┬──────────────┘
                        │
              ┌─────────▼──────────┐
              │ Virtual Environment │
              │                     │
              │ • Mock File System  │
              │ • Mock Instances    │
              │ • Mock Selection    │
              └─────────┬───────────┘
                        │
              ┌─────────▼──────────┐
              │   Agent Runner      │
              │                     │
              │ • Call /api/chat    │
              │ • Auto-approve all  │
              │ • Capture output    │
              └─────────┬───────────┘
                        │
              ┌─────────▼──────────┐
              │  Report Generator   │
              │                     │
              │ • Terminal output   │
              │ • JSON report       │
              │ • HTML report       │
              └─────────────────────┘
```

---

## Test Structure

### Individual Tool Tests

**One test per tool call**, verifies the agent can:

1. ✅ **get_active_script** - Read current script
2. ✅ **list_selection** - List selected instances
3. ✅ **list_open_documents** - List open files
4. ✅ **show_diff** - Propose code changes
5. ✅ **apply_edit** - Apply code edits
6. ✅ **create_instance** - Create new instances
7. ✅ **set_properties** - Modify instance properties
8. ✅ **rename_instance** - Rename instances
9. ✅ **delete_instance** - Delete instances
10. ✅ **search_assets** - Search Roblox catalog
11. ✅ **insert_asset** - Insert assets

### Scenario Tests (Real-World)

**Two comprehensive tests** that combine multiple tools:

1. ✅ **Scenario A: "Create a Blinking Part"**
   - Create Part instance
   - Create Script in Part
   - Generate blinking code
   - Set initial color property

2. ✅ **Scenario B: "Build a Player Leaderboard"**
   - Create UI structure (ScreenGui, Frame, TextLabels)
   - Generate leaderboard script
   - Set properties (Size, Position, Text)
   - Link events

---

## File Structure

```
vector/apps/web/
├── lib/
│   └── testing/
│       ├── TESTING_ENVIRONMENT.md       # This doc
│       │
│       ├── runner/
│       │   ├── test-runner.ts           # Main CLI runner
│       │   ├── virtual-env.ts           # Mock Studio state
│       │   ├── agent-executor.ts        # Execute agent prompts
│       │   └── report-generator.ts      # Generate reports
│       │
│       ├── tests/
│       │   ├── tool-tests.ts            # Individual tool tests
│       │   └── scenario-tests.ts        # Real-world scenarios
│       │
│       └── fixtures/
│           ├── default-state.ts         # Initial virtual state
│           └── test-prompts.ts          # Test prompt templates
│
├── scripts/
│   └── test-agent.ts                    # Entry point: npm run test:agent
│
└── test-results/
    ├── latest.json                      # JSON output
    ├── latest.html                      # HTML report
    └── latest.log                       # Raw logs
```

---

## Implementation Details

### 1. Virtual Environment

**File:** `lib/testing/runner/virtual-env.ts`

Simulates Roblox Studio environment in-memory.

```typescript
interface VirtualEnvironment {
  // File System
  files: Map<string, VirtualFile>;

  // Instance Hierarchy
  instances: Map<string, VirtualInstance>;
  dataModel: VirtualInstance; // Root "game"

  // Current State
  activeScript: string | null;
  selection: string[];

  // Change History
  changes: Change[];
}

interface VirtualFile {
  path: string;
  content: string;
  language: 'lua' | 'luau';
  created: number;
  modified: number;
}

interface VirtualInstance {
  path: string;           // e.g., "game.Workspace.Part1"
  className: string;      // e.g., "Part"
  name: string;           // e.g., "Part1"
  parent: string | null;
  children: string[];
  properties: Record<string, any>;
}

interface Change {
  timestamp: number;
  type: 'file_create' | 'file_update' | 'instance_create' | 'property_set' | 'instance_delete';
  target: string;
  before?: any;
  after?: any;
  toolCall?: string;
}

class VirtualEnvironment {
  constructor(initialState?: Partial<VirtualEnvironment>);

  // File operations
  createFile(path: string, content: string): void;
  updateFile(path: string, content: string): void;
  getFile(path: string): VirtualFile | null;

  // Instance operations
  createInstance(parent: string, className: string, name: string): VirtualInstance;
  setProperties(path: string, props: Record<string, any>): void;
  deleteInstance(path: string): void;
  getInstance(path: string): VirtualInstance | null;

  // State
  setActiveScript(path: string | null): void;
  setSelection(paths: string[]): void;

  // Context generation
  getContext(): ChatContext;

  // History
  getChanges(): Change[];
  exportState(): SerializedState;
}
```

**Default State:**
```typescript
const DEFAULT_STATE = {
  instances: new Map([
    ['game', { className: 'DataModel', name: 'Game', ... }],
    ['game.Workspace', { className: 'Workspace', name: 'Workspace', ... }],
    ['game.ReplicatedStorage', { className: 'ReplicatedStorage', ... }],
    ['game.ServerScriptService', { className: 'ServerScriptService', ... }],
  ]),
  files: new Map([
    ['game.ServerScriptService.MainScript', {
      path: 'game.ServerScriptService.MainScript',
      content: '-- MainScript.lua\nprint("Hello, Vector!")\n',
      language: 'lua'
    }]
  ]),
  activeScript: 'game.ServerScriptService.MainScript',
  selection: []
};
```

---

### 2. Agent Executor

**File:** `lib/testing/runner/agent-executor.ts`

Executes agent prompts with auto-approval.

```typescript
interface ExecutionResult {
  prompt: string;
  toolCalls: ToolCall[];
  proposals: Proposal[];
  changes: Change[];
  finalState: SerializedState;
  duration: number;
  success: boolean;
  error?: string;
}

interface ToolCall {
  timestamp: number;
  tool: string;
  params: any;
  result?: any;
  duration: number;
}

class AgentExecutor {
  constructor(private env: VirtualEnvironment) {}

  async execute(prompt: string, options?: ExecuteOptions): Promise<ExecutionResult> {
    const startTime = Date.now();
    const toolCalls: ToolCall[] = [];
    const proposals: Proposal[] = [];

    // Get context from virtual env
    const context = this.env.getContext();

    // Call /api/chat
    const response = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'test-env',
        message: prompt,
        context,
        mode: 'agent',
        autoApply: true // Auto-approve everything
      })
    });

    // Parse streaming response
    const reader = response.body!.getReader();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += new TextDecoder().decode(value);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));

          // Track tool calls
          if (data.type === 'tool_call') {
            toolCalls.push({
              timestamp: Date.now(),
              tool: data.tool,
              params: data.params,
              duration: 0
            });
          }

          // Track proposals
          if (data.type === 'proposal') {
            proposals.push(data.proposal);

            // Auto-apply
            await this.applyProposal(data.proposal);
          }
        }
      }
    }

    return {
      prompt,
      toolCalls,
      proposals,
      changes: this.env.getChanges(),
      finalState: this.env.exportState(),
      duration: Date.now() - startTime,
      success: true
    };
  }

  private async applyProposal(proposal: Proposal): Promise<void> {
    switch (proposal.tool) {
      case 'apply_edit':
        this.env.updateFile(proposal.params.path, proposal.params.newContent);
        break;
      case 'create_instance':
        this.env.createInstance(
          proposal.params.parent,
          proposal.params.className,
          proposal.params.name
        );
        break;
      case 'set_properties':
        this.env.setProperties(proposal.params.path, proposal.params.properties);
        break;
      // ... other tools
    }
  }
}
```

---

### 3. Test Definitions

**File:** `lib/testing/tests/tool-tests.ts`

Individual tool tests.

```typescript
interface ToolTest {
  name: string;
  description: string;
  tool: string;
  prompt: string;
  setup?: (env: VirtualEnvironment) => void;
  verify: (result: ExecutionResult) => TestVerification;
}

interface TestVerification {
  passed: boolean;
  errors: string[];
  warnings: string[];
  details: string[];
}

export const TOOL_TESTS: ToolTest[] = [
  {
    name: 'get_active_script',
    description: 'Agent should read the active script content',
    tool: 'get_active_script',
    prompt: 'What is in the current script?',
    verify: (result) => {
      const hasToolCall = result.toolCalls.some(c => c.tool === 'get_active_script');
      return {
        passed: hasToolCall,
        errors: hasToolCall ? [] : ['Agent did not call get_active_script'],
        warnings: [],
        details: [`Tool calls: ${result.toolCalls.map(c => c.tool).join(', ')}`]
      };
    }
  },

  {
    name: 'show_diff',
    description: 'Agent should propose code changes with diff',
    tool: 'show_diff',
    prompt: 'Add a comment at the top that says "Testing Vector"',
    verify: (result) => {
      const hasDiff = result.toolCalls.some(c => c.tool === 'show_diff');
      const hasEdit = result.changes.some(c => c.type === 'file_update');
      const content = result.finalState.files.get('game.ServerScriptService.MainScript')?.content;
      const hasComment = content?.includes('Testing Vector');

      return {
        passed: hasDiff && hasEdit && hasComment,
        errors: [
          !hasDiff && 'Agent did not call show_diff',
          !hasEdit && 'No file changes applied',
          !hasComment && 'Comment not found in code'
        ].filter(Boolean) as string[],
        warnings: [],
        details: [
          `Diff shown: ${hasDiff}`,
          `Edit applied: ${hasEdit}`,
          `Comment added: ${hasComment}`
        ]
      };
    }
  },

  {
    name: 'create_instance',
    description: 'Agent should create a new instance',
    tool: 'create_instance',
    prompt: 'Create a Part in Workspace called TestPart',
    verify: (result) => {
      const hasCreate = result.toolCalls.some(c => c.tool === 'create_instance');
      const partExists = result.finalState.instances.has('game.Workspace.TestPart');
      const instance = result.finalState.instances.get('game.Workspace.TestPart');

      return {
        passed: hasCreate && partExists && instance?.className === 'Part',
        errors: [
          !hasCreate && 'Agent did not call create_instance',
          !partExists && 'Part was not created',
          instance?.className !== 'Part' && 'Wrong className'
        ].filter(Boolean) as string[],
        warnings: [],
        details: [
          `Instance created: ${partExists}`,
          `ClassName: ${instance?.className || 'none'}`,
          `Path: ${instance?.path || 'none'}`
        ]
      };
    }
  },

  {
    name: 'set_properties',
    description: 'Agent should modify instance properties',
    tool: 'set_properties',
    prompt: 'Make the Part red',
    setup: (env) => {
      env.createInstance('game.Workspace', 'Part', 'TestPart');
      env.setSelection(['game.Workspace.TestPart']);
    },
    verify: (result) => {
      const hasSetProps = result.toolCalls.some(c => c.tool === 'set_properties');
      const instance = result.finalState.instances.get('game.Workspace.TestPart');
      const hasColor = instance?.properties?.Color !== undefined;

      return {
        passed: hasSetProps && hasColor,
        errors: [
          !hasSetProps && 'Agent did not call set_properties',
          !hasColor && 'Color property not set'
        ].filter(Boolean) as string[],
        warnings: [],
        details: [
          `Properties set: ${hasSetProps}`,
          `Color: ${JSON.stringify(instance?.properties?.Color)}`
        ]
      };
    }
  },

  // ... tests for all other tools
];
```

**File:** `lib/testing/tests/scenario-tests.ts`

Real-world scenario tests.

```typescript
export const SCENARIO_TESTS: ScenarioTest[] = [
  {
    name: 'Create Blinking Part',
    description: 'Multi-step task: create part, add script, make it blink',
    prompt: 'Create a part that blinks between red and blue every second',
    expectedTools: [
      'create_instance',    // Create Part
      'create_instance',    // Create Script in Part
      'show_diff',          // Show script code
      'apply_edit',         // Apply script
      'set_properties'      // Set initial color
    ],
    verify: (result) => {
      const partExists = result.finalState.instances.has('game.Workspace.Part');
      const scriptExists = Array.from(result.finalState.files.keys())
        .some(k => k.includes('Script'));
      const scriptContent = Array.from(result.finalState.files.values())
        .find(f => f.path.includes('Script'))?.content || '';
      const hasBlinkLogic = scriptContent.includes('while') &&
                           scriptContent.includes('Color3');

      return {
        passed: partExists && scriptExists && hasBlinkLogic,
        errors: [
          !partExists && 'Part not created',
          !scriptExists && 'Script not created',
          !hasBlinkLogic && 'Blinking logic not found in script'
        ].filter(Boolean) as string[],
        warnings: result.toolCalls.length > 10 ? ['Too many tool calls'] : [],
        details: [
          `Tool calls: ${result.toolCalls.length}`,
          `Duration: ${result.duration}ms`,
          `Files created: ${result.changes.filter(c => c.type === 'file_create').length}`,
          `Instances created: ${result.changes.filter(c => c.type === 'instance_create').length}`
        ]
      };
    }
  },

  {
    name: 'Build Player Leaderboard',
    description: 'Complex UI task: create GUI structure and script',
    prompt: 'Create a leaderboard GUI that shows player names and scores',
    expectedTools: [
      'create_instance',    // ScreenGui
      'create_instance',    // Frame
      'create_instance',    // TextLabel (template)
      'create_instance',    // Script
      'set_properties',     // Multiple for positioning
      'show_diff',          // Leaderboard logic
      'apply_edit'
    ],
    verify: (result) => {
      const guiExists = Array.from(result.finalState.instances.values())
        .some(i => i.className === 'ScreenGui');
      const frameExists = Array.from(result.finalState.instances.values())
        .some(i => i.className === 'Frame');
      const scriptExists = Array.from(result.finalState.files.values())
        .some(f => f.content.includes('leaderboard') || f.content.includes('Leaderboard'));

      return {
        passed: guiExists && frameExists && scriptExists,
        errors: [
          !guiExists && 'ScreenGui not created',
          !frameExists && 'Frame not created',
          !scriptExists && 'Leaderboard script not found'
        ].filter(Boolean) as string[],
        warnings: [],
        details: [
          `GUI instances: ${Array.from(result.finalState.instances.values()).filter(i => i.className.includes('Gui') || i.className.includes('Frame') || i.className.includes('Label')).length}`,
          `Tool calls: ${result.toolCalls.length}`,
          `Duration: ${result.duration}ms`
        ]
      };
    }
  }
];
```

---

### 4. Test Runner

**File:** `lib/testing/runner/test-runner.ts`

Main test execution logic.

```typescript
interface TestRunOptions {
  filter?: string;          // Run specific tests
  verbose?: boolean;        // Show detailed output
  saveResults?: boolean;    // Save to test-results/
  timeout?: number;         // Per-test timeout
}

interface TestRunResult {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  results: TestResult[];
}

interface TestResult {
  test: string;
  passed: boolean;
  duration: number;
  errors: string[];
  warnings: string[];
  execution: ExecutionResult;
}

class TestRunner {
  async run(options: TestRunOptions = {}): Promise<TestRunResult> {
    console.log('🧪 Vector Agent Test Runner\n');

    const allTests = [...TOOL_TESTS, ...SCENARIO_TESTS];
    const tests = options.filter
      ? allTests.filter(t => t.name.includes(options.filter))
      : allTests;

    const results: TestResult[] = [];
    const startTime = Date.now();

    for (const test of tests) {
      console.log(`\n▶ Running: ${test.name}`);
      console.log(`  ${test.description}`);

      try {
        const result = await this.runTest(test, options);
        results.push(result);

        if (result.passed) {
          console.log(`  ✅ PASSED (${result.duration}ms)`);
        } else {
          console.log(`  ❌ FAILED (${result.duration}ms)`);
          result.errors.forEach(e => console.log(`     - ${e}`));
        }

        if (options.verbose) {
          this.printDetails(result);
        }

      } catch (error) {
        console.log(`  💥 ERROR: ${error}`);
        results.push({
          test: test.name,
          passed: false,
          duration: 0,
          errors: [String(error)],
          warnings: [],
          execution: {} as any
        });
      }
    }

    const summary = this.generateSummary(results, Date.now() - startTime);
    this.printSummary(summary);

    if (options.saveResults) {
      await this.saveResults(summary);
    }

    return summary;
  }

  private async runTest(test: ToolTest | ScenarioTest, options: TestRunOptions): Promise<TestResult> {
    // Create fresh virtual environment
    const env = new VirtualEnvironment();

    // Run setup if provided
    if (test.setup) {
      test.setup(env);
    }

    // Execute agent
    const executor = new AgentExecutor(env);
    const execution = await executor.execute(test.prompt, {
      timeout: options.timeout || 30000
    });

    // Verify results
    const verification = test.verify(execution);

    return {
      test: test.name,
      passed: verification.passed,
      duration: execution.duration,
      errors: verification.errors,
      warnings: verification.warnings,
      execution
    };
  }

  private printDetails(result: TestResult): void {
    console.log(`\n  📋 Tool Calls:`);
    result.execution.toolCalls.forEach(tc => {
      console.log(`     - ${tc.tool}(${JSON.stringify(tc.params).slice(0, 50)}...)`);
    });

    console.log(`\n  📝 Changes:`);
    result.execution.changes.forEach(ch => {
      console.log(`     - ${ch.type}: ${ch.target}`);
    });

    if (result.execution.proposals.length > 0) {
      console.log(`\n  💡 Proposals:`);
      result.execution.proposals.forEach(p => {
        console.log(`     - ${p.tool} (${p.id})`);
      });
    }
  }

  private printSummary(summary: TestRunResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Summary');
    console.log('='.repeat(60));
    console.log(`Total:   ${summary.totalTests}`);
    console.log(`Passed:  ${summary.passed} ✅`);
    console.log(`Failed:  ${summary.failed} ❌`);
    console.log(`Time:    ${summary.duration}ms`);
    console.log('='.repeat(60));
  }

  private async saveResults(summary: TestRunResult): Promise<void> {
    const timestamp = new Date().toISOString();

    // Save JSON
    await writeFile(
      'test-results/latest.json',
      JSON.stringify(summary, null, 2)
    );

    // Generate HTML report
    const html = this.generateHtmlReport(summary);
    await writeFile('test-results/latest.html', html);

    console.log('\n💾 Results saved to test-results/');
  }
}
```

---

### 5. CLI Entry Point

**File:** `scripts/test-agent.ts`

Command-line interface.

```typescript
#!/usr/bin/env ts-node

import { TestRunner } from '../lib/testing/runner/test-runner';

async function main() {
  const args = process.argv.slice(2);

  const options = {
    filter: args.find(a => a.startsWith('--filter='))?.split('=')[1],
    verbose: args.includes('--verbose') || args.includes('-v'),
    saveResults: !args.includes('--no-save'),
    timeout: parseInt(args.find(a => a.startsWith('--timeout='))?.split('=')[1] || '30000')
  };

  const runner = new TestRunner();
  const results = await runner.run(options);

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(console.error);
```

**Add to package.json:**
```json
{
  "scripts": {
    "test:agent": "ts-node scripts/test-agent.ts",
    "test:agent:verbose": "ts-node scripts/test-agent.ts --verbose",
    "test:agent:tools": "ts-node scripts/test-agent.ts --filter=get_",
    "test:agent:scenarios": "ts-node scripts/test-agent.ts --filter=Create"
  }
}
```

---

## Output Examples

### Terminal Output (Normal)

```
🧪 Vector Agent Test Runner

▶ Running: get_active_script
  Agent should read the active script content
  ✅ PASSED (1234ms)

▶ Running: show_diff
  Agent should propose code changes with diff
  ✅ PASSED (2156ms)

▶ Running: create_instance
  Agent should create a new instance
  ✅ PASSED (1876ms)

▶ Running: Create Blinking Part
  Multi-step task: create part, add script, make it blink
  ✅ PASSED (4521ms)

============================================================
📊 Test Summary
============================================================
Total:   13
Passed:  12 ✅
Failed:  1 ❌
Time:    28453ms
============================================================

💾 Results saved to test-results/
```

### Terminal Output (Verbose)

```
▶ Running: create_instance
  Agent should create a new instance

  📋 Tool Calls:
     - get_active_script({})
     - create_instance({"parent":"game.Workspace","clas...})
     - set_properties({"path":"game.Workspace.TestPart"...})

  📝 Changes:
     - instance_create: game.Workspace.TestPart
     - property_set: game.Workspace.TestPart

  💡 Proposals:
     - create_instance (prop_001)
     - set_properties (prop_002)

  ✅ PASSED (1876ms)
```

### JSON Report

```json
{
  "totalTests": 13,
  "passed": 12,
  "failed": 1,
  "duration": 28453,
  "results": [
    {
      "test": "create_instance",
      "passed": true,
      "duration": 1876,
      "errors": [],
      "warnings": [],
      "execution": {
        "prompt": "Create a Part in Workspace called TestPart",
        "toolCalls": [
          {
            "timestamp": 1699564321000,
            "tool": "create_instance",
            "params": {
              "parent": "game.Workspace",
              "className": "Part",
              "name": "TestPart"
            },
            "duration": 234
          }
        ],
        "changes": [
          {
            "type": "instance_create",
            "target": "game.Workspace.TestPart",
            "after": { "className": "Part", "name": "TestPart" }
          }
        ],
        "finalState": { /* ... */ }
      }
    }
  ]
}
```

### HTML Report

```html
<!DOCTYPE html>
<html>
<head>
  <title>Vector Agent Test Results</title>
  <style>/* Tailwind-like styles */</style>
</head>
<body>
  <h1>Test Results</h1>
  <div class="summary">
    <span class="passed">12 Passed</span>
    <span class="failed">1 Failed</span>
  </div>

  <div class="test passed">
    <h2>✅ create_instance</h2>
    <p>Duration: 1876ms</p>

    <h3>Tool Calls</h3>
    <pre>create_instance({ parent: "game.Workspace", ... })</pre>

    <h3>Generated Code</h3>
    <pre class="diff">
      <span class="add">+ local part = Instance.new("Part")</span>
      <span class="add">+ part.Parent = workspace</span>
    </pre>
  </div>
</body>
</html>
```

---

## Usage

### Run All Tests
```bash
npm run test:agent
```

### Run Specific Test
```bash
npm run test:agent -- --filter=create_instance
```

### Run with Verbose Output
```bash
npm run test:agent -- --verbose
```

### Run Only Tool Tests
```bash
npm run test:agent:tools
```

### Run Only Scenarios
```bash
npm run test:agent:scenarios
```

### Custom Timeout
```bash
npm run test:agent -- --timeout=60000
```

---

## Implementation Plan

### Phase 1: Virtual Environment (30 min)
- [ ] Create `VirtualEnvironment` class
- [ ] Implement file operations
- [ ] Implement instance operations
- [ ] Create default state
- [ ] Add context generation

### Phase 2: Agent Executor (30 min)
- [ ] Create `AgentExecutor` class
- [ ] Implement `/api/chat` integration
- [ ] Add streaming response parser
- [ ] Implement proposal auto-apply
- [ ] Track tool calls and changes

### Phase 3: Test Definitions (45 min)
- [ ] Write 11 individual tool tests
- [ ] Write 2 scenario tests
- [ ] Add verification logic for each
- [ ] Create test fixtures

### Phase 4: Test Runner (30 min)
- [ ] Create `TestRunner` class
- [ ] Implement test execution loop
- [ ] Add terminal output formatting
- [ ] Add summary generation

### Phase 5: Reports & CLI (30 min)
- [ ] Create JSON report generator
- [ ] Create HTML report generator
- [ ] Build CLI entry point
- [ ] Add npm scripts
- [ ] Test end-to-end

**Total Time:** ~2.5 hours

---

## Success Criteria

✅ All 11 tool tests pass
✅ Both scenario tests pass
✅ Detailed output for debugging
✅ JSON + HTML reports generated
✅ Can run from command line
✅ Tests complete in < 60 seconds
✅ No manual intervention needed

---

## Next Steps

1. Build Phase 1 (Virtual Environment)
2. Test with simple prompt
3. Build Phase 2 (Agent Executor)
4. Test full execution flow
5. Build Phase 3 (Test Definitions)
6. Run first complete test
7. Build Phase 4 (Test Runner)
8. Build Phase 5 (Reports)
9. Polish and document

---

**Ready to build!** 🚀
