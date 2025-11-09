/**
 * Scenario Tests
 *
 * Real-world multi-step tests that combine multiple tools.
 * These test the agent's ability to handle complex tasks that require
 * planning and using multiple tools in sequence.
 *
 * @module testing/tests/scenario-tests
 */

import { VirtualEnvironment } from '../runner/virtual-env';
import { ExecutionResult } from '../runner/agent-executor';
import { TestVerification } from './tool-tests';

/**
 * Scenario test definition
 */
export interface ScenarioTest {
  name: string;                                      // Test name
  description: string;                               // What this tests
  prompt: string;                                    // Prompt to send to agent
  expectedTools: string[];                           // Tools we expect agent to use
  setup?: (env: VirtualEnvironment) => void;         // Optional environment setup
  verify: (result: ExecutionResult) => TestVerification;  // Verification logic
}

/**
 * All scenario tests
 */
export const SCENARIO_TESTS: ScenarioTest[] = [
  // ============================================================================
  // SCENARIO A: Create Blinking Part
  // ============================================================================

  {
    name: 'Create Blinking Part',
    description: 'Multi-step task: create part, add script, implement blinking logic',
    prompt: 'Create a part in Workspace that blinks between red and blue every second',
    expectedTools: [
      'create_instance',    // Create Part
      'create_instance',    // Create Script in Part
      'show_diff',          // Show script code
      'apply_edit',         // Apply script (or via auto-apply)
      'set_properties'      // Set initial color (optional)
    ],
    verify: (result) => {
      // Check if part was created
      const partExists = result.finalState.instances.some((i: any) => {
        const [path, instance] = i;
        return instance.className === 'Part' &&
               (path.includes('Blink') || path.includes('Part'));
      });

      // Check if script was created
      const scriptExists = result.finalState.files.some((f: any) => {
        const [path] = f;
        return path.includes('Script') &&
               !path.includes('MainScript'); // Not the default script
      });

      // Check script content has blinking logic
      const scriptFile = result.finalState.files.find((f: any) => {
        const [path] = f;
        return path.includes('Script') && !path.includes('MainScript');
      });
      const scriptContent = scriptFile?.[1]?.content || '';

      const hasWhileLoop = scriptContent.includes('while') ||
                           scriptContent.includes('repeat');
      const hasColor3 = scriptContent.includes('Color3') ||
                        scriptContent.includes('BrickColor');
      const hasWait = scriptContent.includes('wait') ||
                      scriptContent.includes('task.wait');
      const hasBlinkingLogic = hasWhileLoop && hasColor3 && hasWait;

      // Check tool calls
      const hasCreateInstance = result.toolCalls.some(c => c.tool === 'create_instance');
      const hasEditTool = result.toolCalls.some(c =>
        c.tool === 'show_diff' || c.tool === 'apply_edit'
      );

      // Calculate score
      const passed = partExists && scriptExists && hasBlinkingLogic &&
                     hasCreateInstance && hasEditTool;

      return {
        passed,
        errors: [
          !partExists && 'Part was not created',
          !scriptExists && 'Script was not created',
          !hasBlinkingLogic && 'Script does not contain blinking logic',
          !hasWhileLoop && 'Script missing loop structure',
          !hasColor3 && 'Script missing Color3 manipulation',
          !hasWait && 'Script missing wait/delay',
          !hasCreateInstance && 'create_instance not called',
          !hasEditTool && 'No code editing performed'
        ].filter(Boolean) as string[],
        warnings: [
          result.toolCalls.length > 15 && 'Many tool calls made (may be inefficient)',
          result.duration > 30000 && 'Test took longer than 30 seconds'
        ].filter(Boolean) as string[],
        details: [
          `Tool calls: ${result.toolCalls.length} (${result.toolCalls.map(c => c.tool).join(', ')})`,
          `Duration: ${result.duration}ms`,
          `Part created: ${partExists}`,
          `Script created: ${scriptExists}`,
          `Has while/repeat: ${hasWhileLoop}`,
          `Has Color3: ${hasColor3}`,
          `Has wait: ${hasWait}`,
          `Files created: ${result.changes.filter(c => c.type === 'file_create').length}`,
          `Instances created: ${result.changes.filter(c => c.type === 'instance_create').length}`,
          `Script length: ${scriptContent.length} chars`
        ]
      };
    }
  },

  // ============================================================================
  // SCENARIO B: Build Player Leaderboard
  // ============================================================================

  {
    name: 'Build Player Leaderboard',
    description: 'Complex UI task: create GUI structure and leaderboard script',
    prompt: 'Create a leaderboard GUI in StarterGui that displays player names and scores',
    expectedTools: [
      'create_instance',    // ScreenGui
      'create_instance',    // Frame
      'create_instance',    // TextLabel or ScrollingFrame
      'create_instance',    // Script
      'set_properties',     // Position, Size, etc.
      'show_diff',          // Leaderboard logic
      'apply_edit'          // Apply script
    ],
    verify: (result) => {
      // Check if ScreenGui was created
      const guiExists = result.finalState.instances.some((i: any) => {
        const [_path, instance] = i;
        return instance.className === 'ScreenGui';
      });

      // Check if Frame was created
      const frameExists = result.finalState.instances.some((i: any) => {
        const [_path, instance] = i;
        return instance.className === 'Frame';
      });

      // Check if script was created with leaderboard logic
      const scriptExists = result.finalState.files.some((f: any) => {
        const [_path, content] = f;
        const code = content?.content || '';
        return (code.includes('leaderboard') ||
                code.includes('Leaderboard') ||
                code.includes('leaderstats')) &&
               code.length > 100; // Must have substantial code
      });

      // Check script content
      const scriptFile = result.finalState.files.find((f: any) => {
        const [path] = f;
        return path.includes('Script') && !path.includes('MainScript');
      });
      const scriptContent = scriptFile?.[1]?.content || '';

      const hasPlayerAdded = scriptContent.includes('PlayerAdded') ||
                             scriptContent.includes('Players:GetPlayers');
      const hasLeaderstats = scriptContent.includes('leaderstats');

      // Count GUI instances created
      const guiInstances = result.finalState.instances.filter((i: any) => {
        const [_path, instance] = i;
        return instance.className.includes('Gui') ||
               instance.className === 'Frame' ||
               instance.className === 'TextLabel' ||
               instance.className === 'TextButton' ||
               instance.className === 'ScrollingFrame';
      });

      // Check tool usage
      const createCalls = result.toolCalls.filter(c => c.tool === 'create_instance').length;
      const hasPropCalls = result.toolCalls.some(c => c.tool === 'set_properties');
      const hasEditCalls = result.toolCalls.some(c =>
        c.tool === 'show_diff' || c.tool === 'apply_edit'
      );

      const passed = guiExists && frameExists && scriptExists &&
                     createCalls >= 3 && hasEditCalls;

      return {
        passed,
        errors: [
          !guiExists && 'ScreenGui not created',
          !frameExists && 'Frame not created',
          !scriptExists && 'Leaderboard script not found',
          createCalls < 3 && `Too few instances created (${createCalls}/3+)`,
          !hasEditCalls && 'No code editing performed'
        ].filter(Boolean) as string[],
        warnings: [
          !hasPlayerAdded && 'Script may not handle PlayerAdded event',
          !hasLeaderstats && 'Script may not use leaderstats',
          !hasPropCalls && 'No properties were set (UI may not be positioned)',
          result.toolCalls.length > 20 && 'Many tool calls made (may be inefficient)',
          result.duration > 45000 && 'Test took longer than 45 seconds'
        ].filter(Boolean) as string[],
        details: [
          `Tool calls: ${result.toolCalls.length} (${result.toolCalls.map(c => c.tool).join(', ')})`,
          `Duration: ${result.duration}ms`,
          `GUI instances: ${guiInstances.length}`,
          `ScreenGui: ${guiExists}`,
          `Frame: ${frameExists}`,
          `Script exists: ${scriptExists}`,
          `Has PlayerAdded: ${hasPlayerAdded}`,
          `Has leaderstats: ${hasLeaderstats}`,
          `Create calls: ${createCalls}`,
          `Property calls: ${result.toolCalls.filter(c => c.tool === 'set_properties').length}`,
          `Files created: ${result.changes.filter(c => c.type === 'file_create').length}`,
          `Instances created: ${result.changes.filter(c => c.type === 'instance_create').length}`,
          `Script length: ${scriptContent.length} chars`
        ]
      };
    }
  }
];
