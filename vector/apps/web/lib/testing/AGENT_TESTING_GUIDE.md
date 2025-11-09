# Vector Agent Testing Framework

**Complete Guide to Automated Testing for Vector's AI Agent**

---

## Table of Contents

1. [Overview](#overview)
2. [What Gets Tested](#what-gets-tested)
3. [Quick Start](#quick-start)
4. [Architecture](#architecture)
5. [Test Categories](#test-categories)
6. [Running Tests](#running-tests)
7. [Understanding Results](#understanding-results)
8. [Adding New Tests](#adding-new-tests)
9. [Troubleshooting](#troubleshooting)
10. [Technical Reference](#technical-reference)

---

## Overview

### What is This?

The Vector Agent Testing Framework is a **comprehensive automated testing system** that verifies your AI agent's capabilities by simulating Roblox Studio in a virtual environment. It tests not just whether the agent *can* use tools, but whether it uses them **intelligently** and produces **high-quality results**.

### Why This Matters

Traditional testing checks mechanics:
- ❌ "Did the agent create an instance?" → Too simple
- ❌ "Did the agent call the right API?" → Doesn't verify quality

**This framework tests intelligence:**
- ✅ "Did the agent plan before acting?"
- ✅ "Did the agent write idempotent, well-structured code?"
- ✅ "Did the agent create properly aligned, anchored geometry?"
- ✅ "Did the agent prefer assets over manual geometry?"
- ✅ "Did the agent check for duplicates before creating?"

### Key Features

- **Real API Integration** - Tests against your actual `/api/chat` endpoint with real LLM
- **No Manual Intervention** - Fully automated from prompt to verification
- **Virtual Environment** - In-memory Roblox Studio simulation (no actual Studio needed)
- **Comprehensive Reports** - Terminal, JSON, and HTML outputs
- **Intelligence Testing** - Verifies reasoning, planning, and code quality
- **Geometry Quality** - Tests positioning, alignment, anchoring, materials
- **Script Policy** - Ensures agent writes Luau for geometry changes

---

## What Gets Tested

### Test Suite Breakdown

**Total Tests: 8 scenarios + 1 basic tool test**

#### 1. Basic Tool Test (1 test)
- **Create Instance** - Verifies API integration works

#### 2. Intelligence Tests (4 tests) **✨ AI Review Enabled**
- **Create Blinking Part** - Planning, script policy, code quality (loops, Color3, wait, idempotency)
- **Simple Part Creation** - Script policy enforcement (must write Luau even for simple geometry)
- **Build Watch Tower** - Asset-first approach (prefer `search_assets` over manual creation)
- **Avoid Duplicate Creation** - Scene inspection before creating (uses `list_children`)

*These tests use GPT-5 Nano to evaluate code quality, idempotency, and adherence to Roblox best practices.*

#### 3. Geometry Quality Tests (3 tests) **⚙️ Programmatic Checks Only**
- **Build Simple House Structure** - Multi-part structures, anchoring, sizing, materials, hierarchy, proper CFrame positioning
- **Create Aligned Part Grid** - Precise positioning, spacing, alignment, loops for efficiency, color variation
- **Build Ramp or Stairs** - Rotation with CFrame.Angles, WedgeParts, incremental positioning, compound shapes

*These tests use programmatic verification (property checks, string matching, state validation).*

### What Each Test Verifies

#### ✅ **Planning & Strategy**
- Does agent create a plan with `<start_plan>` for multi-step tasks?
- Does plan include specific tool names and targets?
- Does plan mention asset search when appropriate?

#### ✅ **Script Policy Compliance**
- Does agent write Luau script after creating geometry?
- Is the script idempotent (checks for existing objects)?
- Does script rebuild geometry programmatically?

#### ✅ **Code Quality**
- Proper Luau syntax (`Instance.new()`, `CFrame.new()`, `Vector3.new()`)
- Idempotent checks (`FindFirstChild`, `if not`)
- Proper parenting (`.Parent =`)
- Appropriate logic (loops, calculations, conditionals)

#### ✅ **Geometry Quality**
- **Anchoring**: Parts have `Anchored = true`
- **Sizing**: Proper `Vector3` sizes
- **Positioning**: Accurate `CFrame` placement
- **Alignment**: Correct spacing and grid alignment
- **Rotation**: Proper use of `CFrame.Angles`
- **Materials**: Appropriate material settings
- **Hierarchy**: Organized in Models/Folders

#### ✅ **Best Practices**
- Prefers assets over manual geometry
- Inspects scene before creating duplicates
- Uses loops for repetitive structures
- Sets proper properties (Color, Material, etc.)
- Uses WedgePart for ramps/slopes

### ✨ AI Review (Intelligence Tests Only)

Intelligence tests (Create Blinking Part, Simple Part Creation, Build Watch Tower, Avoid Duplicate Creation) use **GPT-5 Nano** to review code quality in addition to programmatic checks.

**What AI Reviews:**
- **Idempotency**: Does code check for existing objects before creating?
- **Anchoring**: Are parts properly anchored?
- **Code Structure**: Loops, proper variable names, clean organization
- **Luau Best Practices**: Instance.new(), CFrame.new(), Color3.fromRGB()
- **Script Policy**: Did agent write Luau for geometry changes?
- **Asset-First Approach**: Did agent search assets before manual creation?

**Scoring:**
- **90-100**: Excellent - All criteria met, production-quality code
- **70-89**: Good - Most criteria met, minor issues
- **50-69**: Acceptable - Basic functionality, some issues
- **Below 50**: Poor - Major issues, fails test

**Setup:**
Add to `.env.local` to enable AI review:
```bash
REVIEWER_OPENAI_API_KEY=your-openai-key
REVIEWER_MODEL=gpt-5-nano-2025-08-07  # Optional, defaults to gpt-5-nano-2025-08-07
```

Without this key, intelligence tests will use programmatic checks only.

---

## Quick Start

### Prerequisites

```bash
# 1. Ensure backend dependencies are installed
cd vector/apps/web
npm install

# 2. Configure API key in .env.local
# Add one of:
ANTHROPIC_API_KEY=your-key-here
# OR
OPENAI_API_KEY=your-key-here
# OR
OPENROUTER_API_KEY=your-key-here
```

### Running Tests

```bash
# Start backend (in separate terminal)
npm run dev

# Run all tests with detailed output
npm run test:agent:verbose

# Run without verbose output
npm run test:agent

# Generate JSON and HTML reports
npm run test:agent:reports

# Run only specific test types
npm run test:agent -- --only=tool        # Tool tests only
npm run test:agent -- --only=scenario    # Scenario tests only

# Run specific tests by name
npm run test:agent -- --only="Create Blinking Part,Build Watch Tower"

# Custom timeout (default 60s per test)
npm run test:agent -- --timeout=120000   # 120 seconds

# Custom API URL
npm run test:agent -- --base-url=http://localhost:3001
```

### Expected Output

```
╔═══════════════════════════════════════════════════════════════════╗
║                    VECTOR AGENT TEST SUITE                        ║
╚═══════════════════════════════════════════════════════════════════╝

Started at: 2024-01-15T10:30:00.000Z

═══════════════════════════════════════════════════════════════════
               SCENARIO TESTS
═══════════════════════════════════════════════════════════════════

📝 Running: Create Blinking Part
   Description: Tests planning, geometry creation, script policy...

✅ Create Blinking Part - PASS
   Duration: 4523ms
   Tool calls: 3

   ✓ Agent created plan with 4 steps
   ✓ Part created
   ✓ Script written (script policy complied)
   ✓ Script has looping logic
   ✓ Script uses Color3/BrickColor
   ✓ Script includes wait/delay
   ✓ Script appears idempotent

[... more tests ...]

═══════════════════════════════════════════════════════════════════
                          TEST SUMMARY
═══════════════════════════════════════════════════════════════════

📊 Results:
   Total tests: 8
   ✅ Passed: 7
   ❌ Failed: 1
   📈 Pass rate: 87.5%
   ⏱️  Total duration: 35240ms (35.2s)

⚡ Performance:
   Average test duration: 4405ms
   Average tool calls: 2.4

💡 Recommendations:
   • Review failed tests above for specific error messages
   • Run with --verbose flag for detailed execution logs
```

---

## Architecture

### System Design

```
┌─────────────────────────────────────────────────────────────┐
│                      Test Runner                             │
│  • Orchestrates test execution                              │
│  • Manages test lifecycle                                   │
│  • Generates reports                                        │
└────────────────────────┬────────────────────────────────────┘
                         │
            ┌────────────┴───────────────┐
            │                            │
┌───────────▼──────────┐    ┌───────────▼──────────┐
│  Virtual Environment │    │   Agent Executor     │
│  • In-memory Studio  │    │  • Calls /api/chat   │
│  • File system       │    │  • Parses responses  │
│  • Instance tree     │    │  • Applies proposals │
│  • Context generator │    │  • Tracks tool calls │
└───────────┬──────────┘    └───────────┬──────────┘
            │                           │
            └──────────┬────────────────┘
                       │
            ┌──────────▼─────────────┐
            │   Real Vector API      │
            │   /api/chat endpoint   │
            │   (with your LLM)      │
            └────────────────────────┘
```

### Components

#### 1. **Virtual Environment** (`virtual-env.ts`)
- Simulates Roblox Studio in-memory
- Maintains file system for scripts
- Tracks instance hierarchy
- Generates context for API calls
- Records all changes for debugging

**Key Methods:**
```typescript
createFile(path, content, language)     // Create script file
createInstance(parent, className, name) // Create instance
setProperties(path, props)              // Set properties
getContext()                            // Generate API context
```

#### 2. **Agent Executor** (`agent-executor.ts`)
- Calls real `/api/chat` endpoint
- Parses JSON responses (not streaming)
- Applies proposals to virtual environment
- Tracks tool calls and performance
- Handles all 4 proposal types

**Proposal Types Handled:**
```typescript
EditProposal      // File edits with range edits
ObjectProposal    // create/set/rename/delete instances
AssetProposal     // search/insert/generate assets
CompletionProposal // Task completion
```

#### 3. **Test Runner** (`test-runner.ts`)
- Loads test definitions
- Executes tests sequentially
- Collects results
- Generates terminal output
- Calculates statistics

#### 4. **Report Generators**
- **JSON Reporter** - Machine-readable for CI/CD
- **HTML Reporter** - Interactive web view with expandable details

---

## Test Categories

### Category 1: Basic Integration

**Purpose:** Verify API connectivity and basic functionality

**Tests:**
- Create Instance

**What's Verified:**
- API responds successfully
- Proposals are generated
- Virtual environment is updated

### Category 2: Intelligence & Reasoning

**Purpose:** Test agent's planning and decision-making

**Tests:**
- Create Blinking Part
- Simple Part Creation
- Build Watch Tower
- Avoid Duplicate Creation

**What's Verified:**
- Planning with `<start_plan>`
- Script policy compliance
- Code idempotency
- Asset-first approach
- Scene inspection

### Category 3: Geometry Quality

**Purpose:** Verify geometric construction quality

**Tests:**
- Build Simple House Structure
- Create Aligned Part Grid
- Build Ramp or Stairs

**What's Verified:**
- Proper anchoring
- Accurate positioning (CFrame)
- Correct sizing (Vector3)
- Material properties
- Rotation and orientation
- Multi-part structures
- Organizational hierarchy

---

## Running Tests

### Command Line Options

```bash
# Full syntax
npm run test:agent -- [OPTIONS]

# Options:
--verbose, -v          # Detailed execution logs
--json                 # Generate JSON report
--html                 # Generate HTML report
--skip-tools           # Skip tool tests
--skip-scenarios       # Skip scenario tests
--only=<filter>        # Run specific tests
--timeout=<ms>         # Test timeout (default: 60000)
--base-url=<url>       # API URL (default: http://localhost:3000)
--output=<dir>         # Report output directory
--help, -h             # Show help
```

### Examples

```bash
# Most common: Run all tests with verbose output
npm run test:agent:verbose

# Generate both JSON and HTML reports
npm run test:agent:reports

# Run only geometry tests
npm run test:agent -- --only="Build Simple House,Create Aligned Part Grid,Build Ramp"

# Run with custom timeout for slow LLMs
npm run test:agent -- --timeout=180000 --verbose

# Generate reports to custom directory
npm run test:agent -- --json --html --output=./my-reports
```

### CI/CD Integration

```yaml
# Example GitHub Actions
- name: Run Vector Agent Tests
  run: |
    cd vector/apps/web
    npm run dev &  # Start backend
    sleep 5        # Wait for startup
    npm run test:agent:reports
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

- name: Upload Test Reports
  uses: actions/upload-artifact@v3
  with:
    name: test-reports
    path: vector/apps/web/test-results/
```

---

## Understanding Results

### Terminal Output

#### Test Result Format

```
✅ Test Name - PASS          ← Status indicator
   Duration: 4523ms          ← How long it took
   Tool calls: 3             ← Number of tool calls

   ✓ Detail 1                ← Success details
   ✓ Detail 2
   ⚠️  Warning 1             ← Warnings (test still passes)
```

```
❌ Test Name - FAIL          ← Failed test
   Duration: 2341ms
   Tool calls: 1

   ❌ Errors:
      • Error message 1       ← Why it failed
      • Error message 2

   ⚠️  Warnings:
      • Warning message       ← Issues that don't fail test
```

#### Summary Statistics

```
📊 Results:
   Total tests: 8            ← Total executed
   ✅ Passed: 7              ← Successful tests
   ❌ Failed: 1              ← Failed tests
   📈 Pass rate: 87.5%       ← Percentage

⚡ Performance:
   Average test duration: 4405ms    ← Speed
   Average tool calls: 2.4          ← Efficiency
```

### JSON Report

Located at: `test-results/test-results.json`

```json
{
  "summary": {
    "totalTests": 8,
    "passed": 7,
    "failed": 1,
    "passRate": 87.5,
    "duration": 35240,
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "scenarioTests": [
    {
      "name": "Create Blinking Part",
      "type": "scenario",
      "passed": true,
      "duration": 4523,
      "toolCalls": 3,
      "errors": [],
      "warnings": [],
      "details": ["✓ Agent created plan", "✓ Script written"]
    }
  ],
  "performance": {
    "avgDuration": 4405,
    "avgToolCalls": 2.4
  }
}
```

### HTML Report

Located at: `test-results/test-results.html`

**Features:**
- Interactive expandable test details
- Color-coded pass/fail
- Performance charts
- Clickable sections
- Responsive design
- No external dependencies

**Open in browser:**
```bash
open test-results/test-results.html
# or
xdg-open test-results/test-results.html
```

---

## Adding New Tests

### Creating a New Scenario Test

**Step 1:** Open `lib/testing/tests/scenario-tests.ts`

**Step 2:** Add to `SCENARIO_TESTS` array:

```typescript
{
  name: 'My New Test',
  description: 'What this test verifies',
  prompt: 'The prompt to send to the agent',
  expectedTools: ['tool1', 'tool2'],  // Optional

  setup: (env) => {
    // Optional: Pre-populate environment
    env.createInstance('game.Workspace', 'Part', 'TestPart');
  },

  verify: (result) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const details: string[] = [];

    // Your verification logic here
    if (!result.proposals.length) {
      errors.push('No proposals generated');
    }

    // Check script quality
    const scriptFile = result.finalState.files.find(f =>
      f[0].includes('Script')
    );

    if (scriptFile) {
      const [path, file] = scriptFile;
      const content = file.content.toLowerCase();

      if (content.includes('anchored = true')) {
        details.push('✓ Script sets Anchored property');
      } else {
        warnings.push('Script should set Anchored');
      }
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
      details
    };
  }
}
```

### Test Verification Patterns

#### Pattern 1: Check Script Content

```typescript
const scriptFile = result.finalState.files.find(f =>
  f[0].includes('Script')
);

if (scriptFile) {
  const content = scriptFile[1].content.toLowerCase();

  // Check for specific patterns
  if (content.includes('instance.new')) {
    details.push('✓ Uses Instance.new()');
  }

  if (!content.includes('anchored')) {
    errors.push('Missing Anchored property');
  }
}
```

#### Pattern 2: Check Created Instances

```typescript
const parts = result.finalState.instances.filter(i => {
  const [path, inst] = i;
  return inst.className === 'Part';
});

if (parts.length < 3) {
  errors.push(`Only ${parts.length} parts (expected 3+)`);
}

// Check properties
for (const [path, inst] of parts) {
  if (inst.properties.Anchored !== true) {
    warnings.push(`Part ${inst.name} not anchored`);
  }
}
```

#### Pattern 3: Check Planning

```typescript
if (result.taskState?.plan?.steps?.length > 0) {
  details.push(`✓ Created plan (${result.taskState.plan.steps.length} steps)`);

  const planText = result.taskState.plan.steps.join(' ');
  if (planText.includes('search')) {
    details.push('✓ Plan mentions asset search');
  }
}
```

#### Pattern 4: Check Tool Usage

```typescript
const usedAssetSearch = result.toolCalls.some(tc =>
  tc.tool === 'search_assets'
);

if (!usedAssetSearch) {
  errors.push('Should search for assets first');
}
```

---

## Troubleshooting

### Common Issues

#### 1. Tests Fail with "API error 500"

**Cause:** Backend not running or crashed

**Solution:**
```bash
# Check if backend is running
curl http://localhost:3000/api/health  # (if health endpoint exists)

# Restart backend
cd vector/apps/web
npm run dev
```

#### 2. Tests Timeout

**Cause:** LLM taking too long to respond

**Solution:**
```bash
# Increase timeout
npm run test:agent -- --timeout=180000  # 3 minutes
```

#### 3. "No API key found"

**Cause:** Missing API key in `.env.local`

**Solution:**
```bash
cd vector/apps/web
echo "ANTHROPIC_API_KEY=your-key" >> .env.local
# OR
echo "OPENAI_API_KEY=your-key" >> .env.local
```

#### 4. All Tests Fail with "Script policy violation"

**Cause:** Agent not writing scripts (check system prompt)

**Debug:**
```bash
# Run with verbose to see what agent returns
npm run test:agent:verbose

# Check if proposals include 'edit' type
# Look for: "📦 Response received: Proposals: X"
```

#### 5. Geometry Tests Fail with Property Errors

**Cause:** Agent not setting required properties

**Check:**
```bash
# Run verbose and look for:
# "🔨 Object Operations: ..."
# Check which properties are being set
```

---

## Technical Reference

### File Structure

```
vector/apps/web/
├── lib/testing/
│   ├── runner/
│   │   ├── virtual-env.ts        # Virtual Studio simulation
│   │   ├── agent-executor.ts     # API caller & proposal applier
│   │   └── test-runner.ts        # Test orchestrator
│   ├── tests/
│   │   ├── tool-tests.ts         # Basic tool tests
│   │   └── scenario-tests.ts     # Scenario tests (THIS FILE)
│   └── reports/
│       ├── json-reporter.ts      # JSON report generator
│       └── html-reporter.ts      # HTML report generator
├── scripts/
│   └── test-agent.ts             # CLI entry point
└── package.json                   # NPM scripts
```

### API Integration

**Request Format:**
```typescript
POST /api/chat
{
  projectId: 'test-env',
  message: 'Create a blinking part...',
  context: {
    activeScript: { path, text } | null,
    selection: [{ className, path }],
    scene: { nodes: [...] }
  },
  mode: 'agent',
  autoApply: true
}
```

**Response Format:**
```typescript
{
  workflowId: string,
  proposals: Proposal[],
  taskState: {
    plan?: { steps: string[] },
    ...
  },
  isComplete: boolean
}
```

### Proposal Types Reference

```typescript
// Type 1: Edit Proposal
{
  id: string,
  type: 'edit',
  files: [{
    path: string,
    diff: {
      mode: 'rangeEDITS',
      edits: [{ start, end, text }]
    }
  }]
}

// Type 2: Object Proposal
{
  id: string,
  type: 'object_op',
  ops: [
    { op: 'create_instance', className, parentPath, props },
    { op: 'set_properties', path, props },
    { op: 'rename_instance', path, newName },
    { op: 'delete_instance', path }
  ]
}

// Type 3: Asset Proposal
{
  id: string,
  type: 'asset_op',
  search?: { query, tags, limit },
  insert?: { assetId, parentPath },
  generate3d?: { prompt }
}

// Type 4: Completion Proposal
{
  id: string,
  type: 'completion',
  summary: string
}
```

### Environment Variables

```bash
# Required (at least one)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...

# Optional
VECTOR_DEFAULT_PROVIDER=openrouter  # or gemini, bedrock, nvidia
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
VECTOR_MAX_TURNS=4
```

---

## Best Practices

### Writing Good Tests

1. **Test Intelligence, Not Just Mechanics**
   - ❌ "Did it create instance?"
   - ✅ "Did it plan, then create, then write script?"

2. **Be Specific in Prompts**
   - ❌ "Make a house"
   - ✅ "Build a house with floor (16x1x16), 4 walls, and a roof"

3. **Verify Multiple Aspects**
   ```typescript
   // Check planning
   // Check geometry quality
   // Check script policy
   // Check code quality
   ```

4. **Use Warnings for Non-Critical Issues**
   ```typescript
   if (!hasMaterial) {
     warnings.push('Should set Material'); // Warning, not error
   }
   ```

5. **Provide Helpful Error Messages**
   ```typescript
   errors.push('No script written (violates script policy: must write Luau for geometry changes)');
   // Not just: errors.push('No script');
   ```

### Performance Tips

- Run scenario tests only: `--only=scenario` (faster)
- Use lower timeout for quick checks: `--timeout=30000`
- Skip verbose mode for CI/CD (faster terminal output)

---

## Summary

The Vector Agent Testing Framework provides **comprehensive automated testing** that goes beyond simple mechanics to verify:

✅ **Intelligence**: Planning, reasoning, decision-making
✅ **Code Quality**: Idempotency, structure, best practices
✅ **Geometry Quality**: Anchoring, positioning, sizing, materials
✅ **Policy Compliance**: Script policy, asset-first approach
✅ **Best Practices**: Scene inspection, duplicate avoidance

**Run tests regularly** to ensure your agent maintains high quality as the system evolves.

---

**Questions or Issues?**

- Check `TESTING_FRAMEWORK_REVIEW.md` for detailed implementation notes
- Review test definitions in `scenario-tests.ts` for examples
- Run with `--verbose` flag to see detailed execution
