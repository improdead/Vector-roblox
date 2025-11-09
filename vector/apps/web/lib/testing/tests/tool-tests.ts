/**
 * Tool Tests
 *
 * Individual tests for each Vector agent tool.
 * Each test verifies that the agent can correctly use a specific tool.
 *
 * Tests cover:
 * - Context tools (get_active_script, list_selection, etc.)
 * - Editing tools (show_diff, apply_edit)
 * - Instance tools (create_instance, set_properties, etc.)
 * - Asset tools (search_assets, insert_asset)
 *
 * @module testing/tests/tool-tests
 */

import { VirtualEnvironment } from '../runner/virtual-env';
import { ExecutionResult } from '../runner/agent-executor';

/**
 * Test verification result
 */
export interface TestVerification {
  passed: boolean;          // Whether the test passed
  errors: string[];         // Error messages (if failed)
  warnings: string[];       // Warning messages
  details: string[];        // Additional details for logging
}

/**
 * Individual tool test definition
 */
export interface ToolTest {
  name: string;                                      // Test name
  description: string;                               // What this tests
  tool: string;                                      // Primary tool being tested
  prompt: string;                                    // Prompt to send to agent
  setup?: (env: VirtualEnvironment) => void;         // Optional environment setup
  verify: (result: ExecutionResult) => TestVerification;  // Verification logic
}

/**
 * All individual tool tests
 */
export const TOOL_TESTS: ToolTest[] = [
  // ============================================================================
  // CONTEXT TOOLS
  // ============================================================================

  {
    name: 'get_active_script',
    description: 'Agent should read the active script content',
    tool: 'get_active_script',
    prompt: 'What is in the currently open script?',
    verify: (result) => {
      const hasToolCall = result.toolCalls.some(c => c.tool === 'get_active_script');
      const mentionsMainScript = result.agentResponse?.includes('MainScript') ||
                                  result.agentResponse?.includes('Hello from Vector');

      return {
        passed: hasToolCall && mentionsMainScript,
        errors: [
          !hasToolCall && 'Agent did not call get_active_script',
          !mentionsMainScript && 'Agent did not reference the script content'
        ].filter(Boolean) as string[],
        warnings: [],
        details: [
          `Tool calls: ${result.toolCalls.map(c => c.tool).join(', ')}`,
          `Response mentions script: ${mentionsMainScript}`
        ]
      };
    }
  },

  {
    name: 'list_selection',
    description: 'Agent should list currently selected instances',
    tool: 'list_selection',
    prompt: 'What instances do I have selected?',
    setup: (env) => {
      // Create a part and select it
      env.createInstance('game.Workspace', 'Part', 'TestPart');
      env.setSelection(['game.Workspace.TestPart']);
    },
    verify: (result) => {
      const hasToolCall = result.toolCalls.some(c => c.tool === 'list_selection');
      const mentionsTestPart = result.agentResponse?.includes('TestPart');

      return {
        passed: hasToolCall && mentionsTestPart,
        errors: [
          !hasToolCall && 'Agent did not call list_selection',
          !mentionsTestPart && 'Agent did not mention the selected part'
        ].filter(Boolean) as string[],
        warnings: [],
        details: [
          `Tool calls: ${result.toolCalls.map(c => c.tool).join(', ')}`,
          `Mentions TestPart: ${mentionsTestPart}`
        ]
      };
    }
  },

  {
    name: 'list_open_documents',
    description: 'Agent should list all open script files',
    tool: 'list_open_documents',
    prompt: 'What script files are currently open?',
    verify: (result) => {
      const hasToolCall = result.toolCalls.some(c => c.tool === 'list_open_documents');

      return {
        passed: hasToolCall,
        errors: [
          !hasToolCall && 'Agent did not call list_open_documents'
        ].filter(Boolean) as string[],
        warnings: [],
        details: [
          `Tool calls: ${result.toolCalls.map(c => c.tool).join(', ')}`
        ]
      };
    }
  },

  // ============================================================================
  // EDITING TOOLS
  // ============================================================================

  {
    name: 'show_diff',
    description: 'Agent should propose code changes with diff preview',
    tool: 'show_diff',
    prompt: 'Add a comment at the top of the script that says "Testing Vector Agent"',
    verify: (result) => {
      const hasDiff = result.toolCalls.some(c => c.tool === 'show_diff');
      const hasEdit = result.changes.some(c => c.type === 'file_update');
      const file = result.finalState.files.find((f: any) =>
        f[0] === 'game.ServerScriptService.MainScript'
      );
      const content = file?.[1]?.content || '';
      const hasComment = content.includes('Testing Vector Agent');

      return {
        passed: hasDiff && hasEdit && hasComment,
        errors: [
          !hasDiff && 'Agent did not call show_diff',
          !hasEdit && 'No file changes were applied',
          !hasComment && 'Comment not found in final code'
        ].filter(Boolean) as string[],
        warnings: [],
        details: [
          `Diff shown: ${hasDiff}`,
          `Edit applied: ${hasEdit}`,
          `Comment added: ${hasComment}`,
          `Final content length: ${content.length} chars`
        ]
      };
    }
  },

  {
    name: 'apply_edit',
    description: 'Agent should apply code edits to scripts',
    tool: 'apply_edit',
    prompt: 'Replace the print statement with print("Vector is awesome!")',
    verify: (result) => {
      const hasApply = result.toolCalls.some(c => c.tool === 'apply_edit' || c.tool === 'show_diff');
      const hasChange = result.changes.some(c => c.type === 'file_update');
      const file = result.finalState.files.find((f: any) =>
        f[0] === 'game.ServerScriptService.MainScript'
      );
      const content = file?.[1]?.content || '';
      const hasNewPrint = content.includes('Vector is awesome');

      return {
        passed: hasApply && hasChange && hasNewPrint,
        errors: [
          !hasApply && 'Agent did not apply edit',
          !hasChange && 'No file changes detected',
          !hasNewPrint && 'New print statement not found'
        ].filter(Boolean) as string[],
        warnings: [],
        details: [
          `Edit applied: ${hasApply}`,
          `Changes: ${result.changes.length}`,
          `New print found: ${hasNewPrint}`
        ]
      };
    }
  },

  // ============================================================================
  // INSTANCE TOOLS
  // ============================================================================

  {
    name: 'create_instance',
    description: 'Agent should create new instances in the hierarchy',
    tool: 'create_instance',
    prompt: 'Create a Part in Workspace called "MyTestPart"',
    verify: (result) => {
      const hasCreate = result.toolCalls.some(c => c.tool === 'create_instance');
      const hasChange = result.changes.some(c =>
        c.type === 'instance_create' && c.target.includes('MyTestPart')
      );
      const instance = result.finalState.instances.find((i: any) =>
        i[0].includes('MyTestPart')
      );
      const isPart = instance?.[1]?.className === 'Part';

      return {
        passed: hasCreate && hasChange && isPart,
        errors: [
          !hasCreate && 'Agent did not call create_instance',
          !hasChange && 'No instance creation detected',
          !isPart && 'Instance is not a Part'
        ].filter(Boolean) as string[],
        warnings: [],
        details: [
          `Tool used: ${hasCreate}`,
          `Instance created: ${hasChange}`,
          `ClassName: ${instance?.[1]?.className || 'none'}`,
          `Path: ${instance?.[0] || 'none'}`
        ]
      };
    }
  },

  {
    name: 'set_properties',
    description: 'Agent should modify instance properties',
    tool: 'set_properties',
    prompt: 'Set the Color property of TestPart to red',
    setup: (env) => {
      env.createInstance('game.Workspace', 'Part', 'TestPart');
      env.setSelection(['game.Workspace.TestPart']);
    },
    verify: (result) => {
      const hasSetProps = result.toolCalls.some(c => c.tool === 'set_properties');
      const hasChange = result.changes.some(c => c.type === 'property_set');
      const instance = result.finalState.instances.find((i: any) =>
        i[0] === 'game.Workspace.TestPart'
      );
      const hasColor = instance?.[1]?.properties?.Color !== undefined;

      return {
        passed: hasSetProps && hasChange && hasColor,
        errors: [
          !hasSetProps && 'Agent did not call set_properties',
          !hasChange && 'No property changes detected',
          !hasColor && 'Color property not set'
        ].filter(Boolean) as string[],
        warnings: [],
        details: [
          `Set properties called: ${hasSetProps}`,
          `Changes: ${result.changes.filter(c => c.type === 'property_set').length}`,
          `Color value: ${JSON.stringify(instance?.[1]?.properties?.Color)}`
        ]
      };
    }
  },

  {
    name: 'rename_instance',
    description: 'Agent should rename instances',
    tool: 'rename_instance',
    prompt: 'Rename TestPart to "RenamedPart"',
    setup: (env) => {
      env.createInstance('game.Workspace', 'Part', 'TestPart');
      env.setSelection(['game.Workspace.TestPart']);
    },
    verify: (result) => {
      const hasRename = result.toolCalls.some(c => c.tool === 'rename_instance');
      const hasChange = result.changes.some(c => c.type === 'instance_rename');
      const renamedExists = result.finalState.instances.some((i: any) =>
        i[0].includes('RenamedPart')
      );
      const oldGone = !result.finalState.instances.some((i: any) =>
        i[0] === 'game.Workspace.TestPart'
      );

      return {
        passed: hasRename && hasChange && renamedExists && oldGone,
        errors: [
          !hasRename && 'Agent did not call rename_instance',
          !hasChange && 'No rename detected',
          !renamedExists && 'RenamedPart not found',
          !oldGone && 'Old TestPart still exists'
        ].filter(Boolean) as string[],
        warnings: [],
        details: [
          `Rename called: ${hasRename}`,
          `New name exists: ${renamedExists}`,
          `Old name gone: ${oldGone}`
        ]
      };
    }
  },

  {
    name: 'delete_instance',
    description: 'Agent should delete instances',
    tool: 'delete_instance',
    prompt: 'Delete the TestPart',
    setup: (env) => {
      env.createInstance('game.Workspace', 'Part', 'TestPart');
      env.setSelection(['game.Workspace.TestPart']);
    },
    verify: (result) => {
      const hasDelete = result.toolCalls.some(c => c.tool === 'delete_instance');
      const hasChange = result.changes.some(c => c.type === 'instance_delete');
      const isGone = !result.finalState.instances.some((i: any) =>
        i[0] === 'game.Workspace.TestPart'
      );

      return {
        passed: hasDelete && hasChange && isGone,
        errors: [
          !hasDelete && 'Agent did not call delete_instance',
          !hasChange && 'No deletion detected',
          !isGone && 'TestPart still exists'
        ].filter(Boolean) as string[],
        warnings: [],
        details: [
          `Delete called: ${hasDelete}`,
          `Instance deleted: ${isGone}`,
          `Remaining instances: ${result.finalState.instances.length}`
        ]
      };
    }
  },

  // ============================================================================
  // ASSET TOOLS
  // ============================================================================

  {
    name: 'search_assets',
    description: 'Agent should search the Roblox asset catalog',
    tool: 'search_assets',
    prompt: 'Search for a sword asset in the catalog',
    verify: (result) => {
      const hasSearch = result.toolCalls.some(c => c.tool === 'search_assets');

      return {
        passed: hasSearch,
        errors: [
          !hasSearch && 'Agent did not call search_assets'
        ].filter(Boolean) as string[],
        warnings: [
          'Asset search may not return results in test environment'
        ],
        details: [
          `Search called: ${hasSearch}`,
          `Tool calls: ${result.toolCalls.map(c => c.tool).join(', ')}`
        ]
      };
    }
  },

  {
    name: 'insert_asset',
    description: 'Agent should insert assets from the catalog',
    tool: 'insert_asset',
    prompt: 'Insert asset ID 1234567 into the Workspace',
    verify: (result) => {
      const hasInsert = result.toolCalls.some(c => c.tool === 'insert_asset');

      return {
        passed: hasInsert,
        errors: [
          !hasInsert && 'Agent did not call insert_asset'
        ].filter(Boolean) as string[],
        warnings: [
          'Asset insertion is not fully supported in virtual environment',
          'The asset will not actually be inserted'
        ],
        details: [
          `Insert called: ${hasInsert}`,
          `Tool calls: ${result.toolCalls.map(c => c.tool).join(', ')}`
        ]
      };
    }
  }
];
