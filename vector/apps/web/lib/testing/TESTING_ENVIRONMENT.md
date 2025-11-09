# Mock Roblox Studio Testing Environment

**Version:** 1.0
**Created:** 2025-11-09
**Purpose:** Browser-based testing playground for Vector agent development and debugging

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Components](#components)
4. [File Structure](#file-structure)
5. [Implementation Plan](#implementation-plan)
6. [API Reference](#api-reference)
7. [Usage Examples](#usage-examples)
8. [Testing Scenarios](#testing-scenarios)

---

## Overview

### Problem
Testing the Vector agent currently requires:
- Running actual Roblox Studio
- Manual plugin installation
- Slow feedback loop
- Difficult to reproduce bugs
- Hard to inspect internal state

### Solution
A **browser-based mock Roblox Studio environment** that simulates:
- File system (Lua scripts)
- Game instance hierarchy (Workspace, ReplicatedStorage, etc.)
- Active script/selection state
- Agent chat interface
- Proposal preview & application
- Real-time tool call logging

### Benefits

✅ **Fast Development**: No Studio restart needed
✅ **Easy Debugging**: Inspect state, tool calls, context
✅ **Reproducible Tests**: Save/load mock states
✅ **Visual Feedback**: See exactly what agent does
✅ **Isolated Testing**: Test individual features without side effects

---

## Architecture

### System Diagram

```mermaid
graph TB
    UI[Browser UI - /test-studio]

    subgraph "Mock Studio Panel"
        Explorer[File Tree Explorer]
        Editor[Script Editor]
        Props[Properties Panel]
        Console[Output Console]
    end

    subgraph "Agent Panel"
        Chat[Chat Interface]
        Proposals[Proposal Previews]
        Log[Tool Call Log]
    end

    State[Mock Studio State Manager]
    Context[Mock Context Provider]
    Applier[Proposal Applier]

    API[/api/chat Endpoint]
    Orchestrator[LLM Orchestrator]

    UI --> Explorer
    UI --> Editor
    UI --> Chat

    Explorer --> State
    Editor --> State
    Chat --> API

    State --> Context
    Context --> API
    API --> Orchestrator

    Orchestrator --> Proposals
    Proposals --> Applier
    Applier --> State

    Orchestrator --> Log
```

### Data Flow

1. **User Action** → Update mock state (edit file, select instance)
2. **Chat Message** → Mock context provider gathers state
3. **API Call** → `/api/chat` with mock context
4. **Agent Response** → Stream to UI, parse proposals
5. **User Approval** → Proposal applier updates mock state
6. **State Change** → UI re-renders with new state

---

## Components

### 1. Mock Studio State Manager

**File:** `lib/testing/mock-studio-state.ts`

**Responsibility:** Central state management for mock Studio environment

#### Interface

```typescript
interface MockStudioState {
  // File System
  files: Map<string, ScriptFile>;

  // Instance Hierarchy
  instances: Map<string, MockInstance>;
  root: MockInstance; // Game root

  // Current State
  activeScript: { path: string; content: string } | null;
  selection: string[]; // Array of instance paths

  // History (for undo/redo)
  history: StateSnapshot[];
  historyIndex: number;

  // Output
  logs: LogEntry[];
}

interface ScriptFile {
  path: string;
  content: string;
  language: 'lua' | 'luau';
  lastModified: number;
}

interface MockInstance {
  path: string;
  className: string;
  name: string;
  parent: string | null;
  children: string[];
  properties: Record<string, any>;
}

interface StateSnapshot {
  timestamp: number;
  files: Map<string, ScriptFile>;
  instances: Map<string, MockInstance>;
  description: string;
}
```

#### Methods

```typescript
class MockStudioStateManager {
  // File Operations
  createFile(path: string, content: string, language?: 'lua' | 'luau'): void
  updateFile(path: string, content: string): void
  deleteFile(path: string): void
  getFile(path: string): ScriptFile | null

  // Instance Operations
  createInstance(
    parent: string,
    className: string,
    name: string,
    properties?: Record<string, any>
  ): MockInstance
  deleteInstance(path: string): void
  setProperties(path: string, props: Record<string, any>): void
  renameInstance(path: string, newName: string): void

  // State Management
  setActiveScript(path: string | null): void
  setSelection(paths: string[]): void

  // History
  createSnapshot(description: string): void
  undo(): boolean
  redo(): boolean

  // Logging
  log(level: 'info' | 'warn' | 'error', message: string): void
  clearLogs(): void

  // Export/Import
  exportState(): SerializedState
  importState(state: SerializedState): void
}
```

#### Default State

```typescript
const DEFAULT_STATE: MockStudioState = {
  instances: new Map([
    ['game', { path: 'game', className: 'DataModel', name: 'Game', ... }],
    ['game.Workspace', { path: 'game.Workspace', className: 'Workspace', ... }],
    ['game.ReplicatedStorage', { ... }],
    ['game.ServerScriptService', { ... }],
  ]),
  files: new Map([
    ['game.ServerScriptService.MainScript', {
      path: 'game.ServerScriptService.MainScript',
      content: '-- MainScript.lua\nprint("Hello from Vector!")\n',
      language: 'lua'
    }]
  ]),
  activeScript: null,
  selection: [],
  history: [],
  historyIndex: -1,
  logs: []
};
```

---

### 2. Mock Context Provider

**File:** `lib/testing/mock-context.ts`

**Responsibility:** Convert mock state → Vector context format

#### Interface

```typescript
function getMockContext(state: MockStudioState): ChatContext {
  return {
    activeScript: state.activeScript ? {
      path: state.activeScript.path,
      text: state.activeScript.content
    } : null,

    selection: state.selection.map(path => {
      const instance = state.instances.get(path);
      return {
        className: instance?.className || '',
        path: path
      };
    }),

    openDocs: Array.from(state.files.values())
      .filter(f => f.path !== state.activeScript?.path)
      .map(f => ({ path: f.path })),

    scene: {
      nodes: Array.from(state.instances.values()).map(inst => ({
        path: inst.path,
        className: inst.className,
        name: inst.name,
        parentPath: inst.parent || undefined,
        props: inst.properties
      }))
    },

    codeDefinitions: [] // Could parse files for functions/classes
  };
}
```

---

### 3. Proposal Applier

**File:** `lib/testing/proposal-applier.ts`

**Responsibility:** Apply agent proposals to mock state

#### Interface

```typescript
class ProposalApplier {
  constructor(private state: MockStudioStateManager) {}

  async applyProposal(proposal: Proposal): Promise<ApplyResult> {
    // Create snapshot before applying
    this.state.createSnapshot(`Before: ${proposal.tool}`);

    try {
      switch (proposal.tool) {
        case 'apply_edit':
          return await this.applyEdit(proposal.params);
        case 'create_instance':
          return await this.createInstance(proposal.params);
        case 'set_properties':
          return await this.setProperties(proposal.params);
        case 'rename_instance':
          return await this.renameInstance(proposal.params);
        case 'delete_instance':
          return await this.deleteInstance(proposal.params);
        default:
          throw new Error(`Unknown tool: ${proposal.tool}`);
      }
    } catch (error) {
      this.state.undo(); // Rollback on error
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async applyEdit(params: ApplyEditParams): Promise<ApplyResult> {
    const { path, edits } = params;
    const file = this.state.getFile(path);

    if (!file) {
      throw new Error(`File not found: ${path}`);
    }

    let content = file.content;

    // Apply edits in reverse order
    const sorted = [...edits].sort((a, b) => {
      if (a.start.line !== b.start.line) return b.start.line - a.start.line;
      return b.start.character - a.start.character;
    });

    for (const edit of sorted) {
      content = this.applyTextEdit(content, edit);
    }

    this.state.updateFile(path, content);
    this.state.log('info', `Applied edits to ${path}`);

    return { success: true };
  }

  // ... other methods
}
```

---

### 4. UI Components

#### MockExplorer Component

**File:** `components/test-studio/MockExplorer.tsx`

**Purpose:** Display file tree and instance hierarchy

```tsx
interface MockExplorerProps {
  state: MockStudioState;
  onSelectFile: (path: string) => void;
  onSelectInstance: (path: string) => void;
}

export function MockExplorer({ state, onSelectFile, onSelectInstance }: MockExplorerProps) {
  return (
    <div className="border rounded p-4">
      <h3 className="font-bold mb-2">Explorer</h3>
      <TreeView root={state.root} instances={state.instances}>
        {(node) => (
          <TreeNode
            node={node}
            onClick={() => {
              if (isScript(node)) {
                onSelectFile(node.path);
              } else {
                onSelectInstance(node.path);
              }
            }}
          />
        )}
      </TreeView>
    </div>
  );
}
```

#### MockScriptEditor Component

**File:** `components/test-studio/MockScriptEditor.tsx`

**Purpose:** Editable script content

```tsx
interface MockScriptEditorProps {
  file: ScriptFile | null;
  onChange: (content: string) => void;
}

export function MockScriptEditor({ file, onChange }: MockScriptEditorProps) {
  if (!file) {
    return <div className="text-gray-500">No file selected</div>;
  }

  return (
    <div className="border rounded">
      <div className="bg-gray-100 px-4 py-2 font-mono text-sm">
        {file.path}
      </div>
      <textarea
        value={file.content}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-96 p-4 font-mono text-sm"
        spellCheck={false}
      />
    </div>
  );
}
```

#### AgentChat Component

**File:** `components/test-studio/AgentChat.tsx`

**Purpose:** Chat interface with streaming responses

```tsx
interface AgentChatProps {
  context: ChatContext;
  onProposal: (proposal: Proposal) => void;
}

export function AgentChat({ context, onProposal }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);

  async function sendMessage() {
    setStreaming(true);

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'test-studio',
        message: input,
        context,
        mode: 'agent'
      })
    });

    const reader = response.body?.getReader();
    let buffer = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += new TextDecoder().decode(value);
      // Parse JSON lines, extract proposals
      // ...
    }

    setStreaming(false);
  }

  return (
    <div className="flex flex-col h-full">
      <ChatHistory messages={messages} />
      <ChatInput
        value={input}
        onChange={setInput}
        onSend={sendMessage}
        disabled={streaming}
      />
    </div>
  );
}
```

#### ProposalCard Component

**File:** `components/test-studio/ProposalCard.tsx`

**Purpose:** Display and approve/reject proposals

```tsx
interface ProposalCardProps {
  proposal: Proposal;
  onApprove: () => void;
  onReject: () => void;
}

export function ProposalCard({ proposal, onApprove, onReject }: ProposalCardProps) {
  return (
    <div className="border rounded p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold">{proposal.tool}</span>
        <span className="text-sm text-gray-500">#{proposal.id}</span>
      </div>

      {proposal.tool === 'show_diff' && (
        <DiffView edits={proposal.params.edits} />
      )}

      {proposal.tool === 'create_instance' && (
        <InstancePreview params={proposal.params} />
      )}

      <div className="flex gap-2 mt-4">
        <button
          onClick={onApprove}
          className="px-4 py-2 bg-green-500 text-white rounded"
        >
          Approve
        </button>
        <button
          onClick={onReject}
          className="px-4 py-2 bg-red-500 text-white rounded"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
```

#### ToolCallLog Component

**File:** `components/test-studio/ToolCallLog.tsx`

**Purpose:** Real-time activity log

```tsx
interface ToolCallLogProps {
  logs: LogEntry[];
}

export function ToolCallLog({ logs }: ToolCallLogProps) {
  return (
    <div className="border rounded p-4 h-48 overflow-y-auto font-mono text-xs">
      {logs.map((log, i) => (
        <div key={i} className={`log-${log.level}`}>
          <span className="text-gray-500">[{formatTime(log.timestamp)}]</span>
          <span className="ml-2">{log.message}</span>
        </div>
      ))}
    </div>
  );
}
```

---

## File Structure

```
vector/apps/web/
├── app/
│   └── test-studio/
│       ├── page.tsx                    # Main test playground page
│       └── layout.tsx                  # Layout wrapper
│
├── components/
│   └── test-studio/
│       ├── MockExplorer.tsx            # File tree + instance hierarchy
│       ├── MockScriptEditor.tsx        # Code editor
│       ├── PropertiesPanel.tsx         # Instance properties
│       ├── OutputConsole.tsx           # Logs display
│       ├── AgentChat.tsx               # Chat interface
│       ├── ProposalCard.tsx            # Proposal preview/actions
│       ├── DiffView.tsx                # Unified diff display
│       ├── ToolCallLog.tsx             # Activity timeline
│       └── StateInspector.tsx          # Debug state viewer
│
└── lib/
    └── testing/
        ├── TESTING_ENVIRONMENT.md      # This document
        ├── mock-studio-state.ts        # State manager class
        ├── mock-context.ts             # Context provider
        ├── proposal-applier.ts         # Apply proposals to state
        ├── default-state.ts            # Initial mock state
        └── utils.ts                    # Helper functions
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Est. 30 min)

**Goal:** Basic mock state and UI skeleton

- [ ] Create `MockStudioStateManager` class
  - [ ] File operations (create, update, delete, get)
  - [ ] Instance operations (create, delete, set props, rename)
  - [ ] State management (active script, selection)
  - [ ] Default state with sample files

- [ ] Create `mock-context.ts` provider
  - [ ] Convert state → ChatContext format
  - [ ] Handle null/undefined cases

- [ ] Create basic page layout
  - [ ] Split screen: Studio panel (left) + Agent panel (right)
  - [ ] Responsive design with Tailwind

**Deliverable:** Empty UI with state manager working

---

### Phase 2: Mock Studio UI (Est. 45 min)

**Goal:** Functional Studio simulation

- [ ] `MockExplorer` component
  - [ ] Render instance tree recursively
  - [ ] Click to select file/instance
  - [ ] Highlight active/selected items
  - [ ] Icons for different instance types

- [ ] `MockScriptEditor` component
  - [ ] Display active script content
  - [ ] Editable textarea with syntax highlighting (optional)
  - [ ] Auto-save on change
  - [ ] Line numbers (optional)

- [ ] `PropertiesPanel` component
  - [ ] Show selected instance properties
  - [ ] Editable property values
  - [ ] Property type formatting

- [ ] `OutputConsole` component
  - [ ] Display logs with timestamps
  - [ ] Color-coded by level (info, warn, error)
  - [ ] Auto-scroll to bottom
  - [ ] Clear button

**Deliverable:** Working mock Studio with file editing

---

### Phase 3: Agent Integration (Est. 45 min)

**Goal:** Connect to existing `/api/chat` endpoint

- [ ] `AgentChat` component
  - [ ] Message list with user/agent messages
  - [ ] Input box with send button
  - [ ] Streaming response handling
  - [ ] Loading state

- [ ] Chat → API integration
  - [ ] Gather context from mock state
  - [ ] POST to `/api/chat`
  - [ ] Stream response via fetch + ReadableStream
  - [ ] Parse JSON lines for proposals

- [ ] `ProposalCard` component
  - [ ] Display proposal details
  - [ ] Show diff for `show_diff`
  - [ ] Show parameters for other tools
  - [ ] Approve/Reject buttons
  - [ ] Status (pending, approved, rejected)

- [ ] `ProposalApplier` class
  - [ ] Implement `applyProposal` method
  - [ ] Handle each tool type
  - [ ] Apply text edits
  - [ ] Create/modify instances
  - [ ] Error handling + rollback

**Deliverable:** End-to-end chat → proposal → apply flow

---

### Phase 4: Debugging Tools (Est. 30 min)

**Goal:** Developer experience improvements

- [ ] `ToolCallLog` component
  - [ ] Log all tool calls with timestamps
  - [ ] Show parameters + results
  - [ ] Expandable details
  - [ ] Filter by tool type

- [ ] `StateInspector` component (debug panel)
  - [ ] Show current state as JSON
  - [ ] Export/import state
  - [ ] Reset to default
  - [ ] View context sent to API

- [ ] History (undo/redo)
  - [ ] Create snapshots on each change
  - [ ] Undo/redo buttons
  - [ ] History timeline
  - [ ] Restore to snapshot

- [ ] Keyboard shortcuts
  - [ ] `Ctrl+Z` → Undo
  - [ ] `Ctrl+Y` → Redo
  - [ ] `Ctrl+Enter` → Send message

**Deliverable:** Full debugging capabilities

---

### Phase 5: Polish & Testing (Est. 30 min)

**Goal:** Production-ready testing environment

- [ ] Styling
  - [ ] Consistent color scheme
  - [ ] Icons for instance types
  - [ ] Hover states
  - [ ] Loading indicators

- [ ] Error handling
  - [ ] Display API errors
  - [ ] Toast notifications
  - [ ] Validation messages

- [ ] Presets
  - [ ] Sample scenarios (e.g., "Create a part", "Add a script")
  - [ ] Quick actions menu
  - [ ] Templates for common tasks

- [ ] Documentation
  - [ ] In-app help tooltips
  - [ ] Keyboard shortcut reference
  - [ ] Example prompts

**Deliverable:** Polished, user-friendly testing environment

---

## API Reference

### MockStudioStateManager

#### Constructor
```typescript
new MockStudioStateManager(initialState?: Partial<MockStudioState>)
```

#### File Methods
```typescript
createFile(path: string, content: string, language?: 'lua' | 'luau'): void
updateFile(path: string, content: string): void
deleteFile(path: string): void
getFile(path: string): ScriptFile | null
getAllFiles(): ScriptFile[]
```

#### Instance Methods
```typescript
createInstance(
  parent: string,
  className: string,
  name: string,
  properties?: Record<string, any>
): MockInstance

deleteInstance(path: string): void
setProperties(path: string, props: Record<string, any>): void
renameInstance(path: string, newName: string): void
getInstance(path: string): MockInstance | null
getChildren(path: string): MockInstance[]
```

#### State Methods
```typescript
setActiveScript(path: string | null): void
getActiveScript(): ScriptFile | null
setSelection(paths: string[]): void
getSelection(): MockInstance[]
```

#### History Methods
```typescript
createSnapshot(description: string): void
undo(): boolean
redo(): boolean
canUndo(): boolean
canRedo(): boolean
getHistory(): StateSnapshot[]
```

#### Logging Methods
```typescript
log(level: 'info' | 'warn' | 'error', message: string): void
clearLogs(): void
getLogs(): LogEntry[]
```

#### Serialization Methods
```typescript
exportState(): SerializedState
importState(state: SerializedState): void
reset(): void
```

---

### ProposalApplier

#### Constructor
```typescript
new ProposalApplier(state: MockStudioStateManager)
```

#### Methods
```typescript
async applyProposal(proposal: Proposal): Promise<ApplyResult>

interface ApplyResult {
  success: boolean;
  error?: string;
  changes?: string[]; // Descriptions of changes made
}
```

---

## Usage Examples

### Example 1: Basic Setup

```tsx
// app/test-studio/page.tsx
'use client';

import { useState } from 'react';
import { MockStudioStateManager } from '@/lib/testing/mock-studio-state';
import { MockExplorer } from '@/components/test-studio/MockExplorer';
import { AgentChat } from '@/components/test-studio/AgentChat';

export default function TestStudioPage() {
  const [state] = useState(() => new MockStudioStateManager());

  return (
    <div className="grid grid-cols-2 gap-4 h-screen p-4">
      <div>
        <MockExplorer state={state} />
      </div>
      <div>
        <AgentChat state={state} />
      </div>
    </div>
  );
}
```

### Example 2: Applying Proposals

```tsx
const applier = new ProposalApplier(state);

async function handleApprove(proposal: Proposal) {
  const result = await applier.applyProposal(proposal);

  if (result.success) {
    state.log('info', `Applied ${proposal.tool}`);
    toast.success('Proposal applied!');
  } else {
    state.log('error', `Failed to apply: ${result.error}`);
    toast.error(result.error);
  }
}
```

### Example 3: Exporting State

```tsx
function ExportButton({ state }: { state: MockStudioStateManager }) {
  function handleExport() {
    const exported = state.exportState();
    const json = JSON.stringify(exported, null, 2);

    // Download as file
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mock-state-${Date.now()}.json`;
    a.click();
  }

  return <button onClick={handleExport}>Export State</button>;
}
```

---

## Testing Scenarios

### Scenario 1: Simple Code Edit

**Goal:** Test `show_diff` → `apply_edit` flow

1. **Setup**: Default state with MainScript.lua
2. **Prompt**: "Add a print statement that says 'Vector is working!'"
3. **Expected**:
   - Agent calls `get_active_script`
   - Agent calls `show_diff` with new print statement
   - User approves
   - Editor updates with new code
   - Log shows "Applied edits to MainScript.lua"

### Scenario 2: Create Instance

**Goal:** Test instance creation

1. **Setup**: Default state
2. **Prompt**: "Create a new Part in Workspace called TestPart"
3. **Expected**:
   - Agent calls `create_instance`
   - Proposal shows: parent=Workspace, className=Part, name=TestPart
   - User approves
   - Explorer updates with new Part under Workspace
   - Selection changes to new Part

### Scenario 3: Multi-Step Task

**Goal:** Test agent mode with multiple tools

1. **Setup**: Default state
2. **Prompt**: "Create a script that makes a part blink red and blue"
3. **Expected**:
   - Agent creates Part
   - Agent creates Script in Part
   - Agent shows diff for script content
   - Agent sets Part Color property
   - All proposals applied in sequence
   - Log shows complete history

### Scenario 4: Error Handling

**Goal:** Test validation and error recovery

1. **Setup**: Default state
2. **Prompt**: "Delete a non-existent script"
3. **Expected**:
   - Agent tries to find script
   - Agent reports error: "Script not found"
   - No state changes
   - Error logged in console

### Scenario 5: Undo/Redo

**Goal:** Test history management

1. **Setup**: Default state
2. **Actions**:
   - Create instance (snapshot)
   - Edit script (snapshot)
   - Delete instance (snapshot)
3. **Expected**:
   - Click Undo → instance restored
   - Click Undo → script reverted
   - Click Undo → back to default
   - Click Redo → forward through history

---

## Advanced Features (Future)

### Performance Testing
- [ ] Measure agent response times
- [ ] Track context size over conversations
- [ ] Monitor cache hit rates
- [ ] Profile tool execution

### Visual Debugging
- [ ] Syntax highlighting in editor
- [ ] Diff gutter in editor
- [ ] Breakpoints for tool calls
- [ ] Step-through mode

### Collaboration
- [ ] Share mock states via URL
- [ ] Export conversation history
- [ ] Compare states (diff viewer)
- [ ] Replay tool calls

### AI Enhancements
- [ ] Test streaming performance improvements
- [ ] Test context caching effectiveness
- [ ] Test multi-file operations
- [ ] Test error recovery flows

---

## FAQ

**Q: Does this replace the actual plugin?**
A: No, this is for development/testing only. The real plugin still runs in Roblox Studio.

**Q: Can I test the actual Roblox API?**
A: No, this mocks the environment. It's for testing agent logic, not Roblox APIs.

**Q: How do I add custom instance types?**
A: Edit `default-state.ts` and add to the `instances` map with proper className.

**Q: Can I test performance improvements here?**
A: Yes! This is perfect for testing streaming, caching, error handling, etc.

**Q: How do I debug why a proposal failed?**
A: Check the ToolCallLog, inspect the state via StateInspector, and look at browser console.

---

## Troubleshooting

### Chat doesn't connect
- Check `/api/chat` endpoint is running
- Verify context format matches API schema
- Check browser console for fetch errors

### Proposals don't apply
- Check ProposalApplier error logs
- Verify file paths exist in mock state
- Ensure proper instance hierarchy

### UI doesn't update
- Check React state updates
- Verify state manager methods called
- Look for console errors

### Performance issues
- Check state size (too many instances?)
- Profile React renders
- Optimize re-renders with `useMemo`

---

## Next Steps

1. **Build Phase 1**: Core infrastructure
2. **Test basic flow**: Create file → Edit → Chat
3. **Build Phase 2**: Complete UI
4. **Test agent**: Run through scenarios
5. **Build Phase 3**: Integrate proposals
6. **Test end-to-end**: Full workflow
7. **Polish**: Add debugging tools
8. **Document**: Add examples and screenshots

---

**Ready to start implementation!** 🚀
