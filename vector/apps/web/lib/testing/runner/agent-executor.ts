/**
 * Agent Executor
 *
 * Executes agent prompts against the real Vector API and applies proposals
 * to the virtual environment. Connects to /api/chat endpoint with auto-approval.
 *
 * Features:
 * - Real API integration with configured LLM provider
 * - Automatic proposal application to virtual environment
 * - Detailed logging of execution flow
 * - Performance tracking and metrics
 * - Support for all proposal types (edit, object_op, asset_op, completion)
 *
 * @module testing/runner/agent-executor
 */

import { VirtualEnvironment } from './virtual-env';

/**
 * Tool call record
 */
export interface ToolCall {
  timestamp: number;
  tool: string;
  params: any;
  duration: number;
}

/**
 * Execution options
 */
export interface ExecuteOptions {
  timeout?: number;           // Timeout in milliseconds
  mode?: 'ask' | 'agent';     // Execution mode
  autoApply?: boolean;        // Auto-apply proposals
  provider?: any;             // Provider config
  model?: string;             // Model override
}

/**
 * Proposal types from orchestrator
 */
type EditPos = { line: number; character: number };
type Edit = { start: EditPos; end: EditPos; text: string };

interface EditProposal {
  id: string;
  type: 'edit';
  files: Array<{
    path: string;
    diff: { mode: 'rangeEDITS'; edits: Edit[] };
    preview?: { unified?: string; before?: string; after?: string };
    safety?: { beforeHash?: string; baseText?: string };
  }>;
  notes?: string;
}

interface ObjectOp {
  op: 'create_instance' | 'set_properties' | 'rename_instance' | 'delete_instance';
  className?: string;
  parentPath?: string;
  path?: string;
  props?: Record<string, any>;
  newName?: string;
}

interface ObjectProposal {
  id: string;
  type: 'object_op';
  ops: ObjectOp[];
  notes?: string;
}

interface AssetProposal {
  id: string;
  type: 'asset_op';
  search?: { query: string; tags?: string[]; limit?: number };
  insert?: { assetId: number; parentPath?: string };
  generate3d?: { prompt: string };
}

interface CompletionProposal {
  id: string;
  type: 'completion';
  summary: string;
  confidence?: number;
}

type Proposal = EditProposal | ObjectProposal | AssetProposal | CompletionProposal;

/**
 * Task state from orchestrator
 */
interface TaskState {
  plan?: {
    steps: string[];
  };
  scriptSources?: Map<string, string>;
  [key: string]: any;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  workflowId: string;
  proposals: Proposal[];
  taskState: TaskState;
  isComplete: boolean;
  toolCalls: ToolCall[];
  duration: number;
  finalState: {
    files: Array<[string, any]>;
    instances: Array<[string, any]>;
  };
}

/**
 * Agent Executor Class
 *
 * Executes prompts against real Vector API and applies proposals.
 */
export class AgentExecutor {
  private env: VirtualEnvironment;
  private verbose: boolean;
  private baseUrl: string;

  /**
   * Create a new agent executor
   * @param env - Virtual environment to execute in
   * @param verbose - Enable detailed logging
   * @param baseUrl - API base URL
   */
  constructor(env: VirtualEnvironment, verbose: boolean = false, baseUrl: string = 'http://localhost:3000') {
    this.env = env;
    this.verbose = verbose;
    this.baseUrl = baseUrl;

    this.log('🤖 Agent Executor initialized');
    this.log(`   Base URL: ${this.baseUrl}`);
  }

  /**
   * Execute a prompt against the Vector API
   * @param prompt - User prompt to execute
   * @param options - Execution options
   * @returns Execution result with proposals and state
   */
  async execute(prompt: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Gather context from virtual environment
      this.log('\n📋 Gathering context from virtual environment...');
      const context = this.env.getContext();
      this.log(`   Active script: ${context.activeScript?.path || 'none'}`);
      this.log(`   Selection: ${context.selection?.length || 0} items`);
      this.log(`   Scene nodes: ${context.scene?.nodes?.length || 0} instances`);

      // Prepare API request
      const requestBody = {
        projectId: 'test-env',
        message: prompt,
        context,
        mode: options.mode || 'agent',
        autoApply: options.autoApply !== false,
        provider: options.provider,
        modelOverride: options.model
      };

      this.log(`\n📡 Calling API: POST ${this.baseUrl}/api/chat`);
      this.log(`   Prompt: "${prompt}"`);

      // Call real API
      const controller = new AbortController();
      const timeoutId = options.timeout
        ? setTimeout(() => controller.abort(), options.timeout)
        : null;

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      this.log('✅ API call successful, parsing response...\n');

      // Parse JSON response (NOT streaming!)
      const data = await response.json();
      const { workflowId, proposals, taskState, isComplete } = data;

      this.log(`📦 Response received:`);
      this.log(`   Workflow ID: ${workflowId}`);
      this.log(`   Proposals: ${proposals?.length || 0}`);
      this.log(`   Complete: ${isComplete}`);

      if (taskState?.plan?.steps) {
        this.log(`\n📋 Plan created with ${taskState.plan.steps.length} steps:`);
        taskState.plan.steps.forEach((step: string, i: number) => {
          this.log(`   ${i + 1}. ${step}`);
        });
      }

      // Track tool calls (extract from proposals)
      const toolCalls: ToolCall[] = [];

      // Apply each proposal
      this.log('\n🔧 Applying proposals to virtual environment...\n');
      for (const proposal of proposals || []) {
        await this.applyProposal(proposal, toolCalls);
      }

      const duration = Date.now() - startTime;

      this.log(`\n✅ Execution complete in ${duration}ms`);
      this.log(`   Tool calls: ${toolCalls.length}`);
      this.log(`   Proposals applied: ${proposals?.length || 0}`);

      return {
        workflowId,
        proposals: proposals || [],
        taskState: taskState || {},
        isComplete: isComplete || false,
        toolCalls,
        duration,
        finalState: {
          files: Array.from(this.env.exportState().files),
          instances: Array.from(this.env.exportState().instances)
        }
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.log(`\n❌ Execution failed after ${duration}ms`);

      if (error instanceof Error) {
        this.log(`   Error: ${error.message}`);
        if (error.name === 'AbortError') {
          throw new Error(`Execution timeout after ${options.timeout}ms`);
        }
      }

      throw error;
    }
  }

  /**
   * Apply a single proposal to the virtual environment
   * @param proposal - Proposal to apply
   * @param toolCalls - Array to track tool calls
   */
  private async applyProposal(proposal: Proposal, toolCalls: ToolCall[]): Promise<void> {
    const startTime = Date.now();

    try {
      switch (proposal.type) {
        case 'edit':
          await this.applyEditProposal(proposal, toolCalls);
          break;

        case 'object_op':
          await this.applyObjectProposal(proposal, toolCalls);
          break;

        case 'asset_op':
          await this.applyAssetProposal(proposal, toolCalls);
          break;

        case 'completion':
          this.log(`✅ Completion: ${proposal.summary}`);
          if (proposal.confidence) {
            this.log(`   Confidence: ${proposal.confidence}`);
          }
          break;

        default:
          this.log(`⚠️  Unknown proposal type: ${(proposal as any).type}`);
      }

    } catch (error) {
      this.log(`❌ Failed to apply proposal: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Apply edit proposal (file edits)
   */
  private async applyEditProposal(proposal: EditProposal, toolCalls: ToolCall[]): Promise<void> {
    this.log(`📝 Edit Proposal: ${proposal.id}`);

    for (const fileChange of proposal.files) {
      const startTime = Date.now();

      this.log(`   File: ${fileChange.path}`);
      this.log(`   Edits: ${fileChange.diff.edits.length}`);

      // Get current file content
      const file = this.env.getFile(fileChange.path);
      const currentContent = file?.content || '';

      // Apply range edits
      const newContent = this.applyRangeEdits(currentContent, fileChange.diff.edits);

      // Update file in virtual environment
      if (file) {
        this.env.updateFile(fileChange.path, newContent);
      } else {
        // Create new file
        this.env.createFile(fileChange.path, newContent, 'luau');
      }

      const duration = Date.now() - startTime;

      toolCalls.push({
        timestamp: Date.now(),
        tool: 'apply_edit',
        params: { path: fileChange.path, edits: fileChange.diff.edits },
        duration
      });

      this.log(`   ✅ Applied ${fileChange.diff.edits.length} edits (${duration}ms)`);
    }
  }

  /**
   * Apply object proposal (instance operations)
   */
  private async applyObjectProposal(proposal: ObjectProposal, toolCalls: ToolCall[]): Promise<void> {
    this.log(`🔨 Object Operations: ${proposal.id}`);
    this.log(`   Operations: ${proposal.ops.length}`);

    for (const op of proposal.ops) {
      const startTime = Date.now();

      switch (op.op) {
        case 'create_instance':
          this.log(`   ➕ Create: ${op.className} at ${op.parentPath}`);
          const name = (op.props as any)?.Name || op.className;
          this.env.createInstance(op.parentPath!, op.className!, name, op.props);
          toolCalls.push({
            timestamp: Date.now(),
            tool: 'create_instance',
            params: op,
            duration: Date.now() - startTime
          });
          break;

        case 'set_properties':
          this.log(`   🔧 Set Properties: ${op.path}`);
          this.env.setProperties(op.path!, op.props!);
          toolCalls.push({
            timestamp: Date.now(),
            tool: 'set_properties',
            params: op,
            duration: Date.now() - startTime
          });
          break;

        case 'rename_instance':
          this.log(`   ✏️  Rename: ${op.path} → ${op.newName}`);
          this.env.renameInstance(op.path!, op.newName!);
          toolCalls.push({
            timestamp: Date.now(),
            tool: 'rename_instance',
            params: op,
            duration: Date.now() - startTime
          });
          break;

        case 'delete_instance':
          this.log(`   🗑️  Delete: ${op.path}`);
          this.env.deleteInstance(op.path!);
          toolCalls.push({
            timestamp: Date.now(),
            tool: 'delete_instance',
            params: op,
            duration: Date.now() - startTime
          });
          break;
      }
    }

    this.log(`   ✅ Applied ${proposal.ops.length} operations`);
  }

  /**
   * Apply asset proposal (asset search/insert)
   */
  private async applyAssetProposal(proposal: AssetProposal, toolCalls: ToolCall[]): Promise<void> {
    const startTime = Date.now();

    if (proposal.search) {
      this.log(`🔍 Asset Search: "${proposal.search.query}"`);
      if (proposal.search.tags) {
        this.log(`   Tags: ${proposal.search.tags.join(', ')}`);
      }
      this.log(`   Limit: ${proposal.search.limit || 10}`);

      toolCalls.push({
        timestamp: Date.now(),
        tool: 'search_assets',
        params: proposal.search,
        duration: Date.now() - startTime
      });
    }

    if (proposal.insert) {
      this.log(`📦 Insert Asset: ${proposal.insert.assetId}`);
      this.log(`   Parent: ${proposal.insert.parentPath || 'game.Workspace'}`);

      // Simulate asset insertion by creating a Model instance
      const parentPath = proposal.insert.parentPath || 'game.Workspace';
      const assetName = `Asset_${proposal.insert.assetId}`;

      this.env.createInstance(parentPath, 'Model', assetName, {
        Name: assetName
      });

      toolCalls.push({
        timestamp: Date.now(),
        tool: 'insert_asset',
        params: proposal.insert,
        duration: Date.now() - startTime
      });

      this.log(`   ✅ Asset inserted as ${parentPath}.${assetName}`);
    }

    if (proposal.generate3d) {
      this.log(`🎨 Generate 3D: "${proposal.generate3d.prompt}"`);

      toolCalls.push({
        timestamp: Date.now(),
        tool: 'generate_asset_3d',
        params: proposal.generate3d,
        duration: Date.now() - startTime
      });
    }
  }

  /**
   * Apply range edits to text content
   * @param content - Original content
   * @param edits - Array of edits to apply
   * @returns Modified content
   */
  private applyRangeEdits(content: string, edits: Edit[]): string {
    // Sort edits by position (start from end to avoid offset issues)
    const sortedEdits = [...edits].sort((a, b) => {
      if (a.start.line !== b.start.line) {
        return b.start.line - a.start.line;
      }
      return b.start.character - a.start.character;
    });

    const lines = content.split('\n');

    for (const edit of sortedEdits) {
      // Convert position to absolute offset
      const startOffset = this.positionToOffset(lines, edit.start);
      const endOffset = this.positionToOffset(lines, edit.end);

      // Reconstruct content
      const fullText = lines.join('\n');
      const before = fullText.substring(0, startOffset);
      const after = fullText.substring(endOffset);
      const modified = before + edit.text + after;

      // Update lines array for next iteration
      lines.length = 0;
      lines.push(...modified.split('\n'));
    }

    return lines.join('\n');
  }

  /**
   * Convert line/character position to absolute offset
   */
  private positionToOffset(lines: string[], pos: EditPos): number {
    let offset = 0;

    // Add full lines before target line
    for (let i = 0; i < pos.line && i < lines.length; i++) {
      offset += lines[i].length + 1; // +1 for newline
    }

    // Add characters in target line
    if (pos.line < lines.length) {
      offset += Math.min(pos.character, lines[pos.line].length);
    }

    return offset;
  }

  /**
   * Log a message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.verbose) {
      console.log(`[AgentExecutor] ${message}`);
    }
  }
}
