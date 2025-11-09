/**
 * Scenario Tests
 *
 * Real-world multi-step tests that verify agent intelligence and reasoning.
 * These tests focus on:
 * - Planning before action
 * - Script policy compliance (writing Luau for geometry)
 * - Code quality (idempotent, anchored parts, etc.)
 * - Appropriate tool usage
 * - Following best practices
 *
 * @module testing/tests/scenario-tests
 */

import { VirtualEnvironment } from '../runner/virtual-env';
import { ExecutionResult } from '../runner/agent-executor';

/**
 * Test verification result
 */
export interface TestVerification {
  passed: boolean;
  errors: string[];
  warnings: string[];
  details: string[];
}

/**
 * Scenario test definition
 */
export interface ScenarioTest {
  name: string;
  description: string;
  prompt: string;
  expectedTools: string[];
  setup?: (env: VirtualEnvironment) => void;
  verify: (result: ExecutionResult) => TestVerification;
}

/**
 * All scenario tests
 */
export const SCENARIO_TESTS: ScenarioTest[] = [
  // ============================================================================
  // SCENARIO 1: Create Blinking Part
  // Tests: Planning, geometry + script, idempotent code
  // ============================================================================

  {
    name: 'Create Blinking Part',
    description: 'Tests planning, geometry creation, script policy compliance, and code quality',
    prompt: 'Create a blinking part that alternates between red and blue every second',
    expectedTools: ['create_instance', 'apply_edit'],

    verify: (result) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const details: string[] = [];

      // 1. Check if agent created a plan
      const hasPlan = result.taskState?.plan?.steps && result.taskState.plan.steps.length > 0;
      if (!hasPlan) {
        errors.push('Agent did not create a plan (expected <start_plan> for multi-step task)');
      } else {
        details.push(`✓ Agent created plan with ${result.taskState.plan!.steps.length} steps`);
      }

      // 2. Check if geometry was created
      const partCreated = result.proposals.some(p =>
        p.type === 'object_op' &&
        p.ops.some((op: any) =>
          op.op === 'create_instance' && op.className === 'Part'
        )
      );

      if (!partCreated) {
        errors.push('No Part instance was created');
      } else {
        details.push('✓ Part created');
      }

      // 3. Check if script was written (script policy)
      const scriptWritten = result.proposals.some(p => p.type === 'edit');

      if (!scriptWritten) {
        errors.push('No script written (violates script policy: must write Luau for geometry changes)');
      } else {
        details.push('✓ Script written (script policy complied)');
      }

      // 4. Check script quality if written
      if (scriptWritten) {
        // Get the script content
        const scriptFile = result.finalState.files.find((f: any) =>
          f[0].includes('Script')
        );

        if (scriptFile) {
          const [path, file] = scriptFile;
          const content = file.content.toLowerCase();

          // Check for while loop or similar
          const hasLoop = content.includes('while') || content.includes('for ') || content.includes('task.wait');
          if (!hasLoop) {
            warnings.push('Script may not have proper looping logic');
          } else {
            details.push('✓ Script has looping logic');
          }

          // Check for Color3
          const hasColor = content.includes('color3') || content.includes('brickcolor');
          if (!hasColor) {
            warnings.push('Script may not manipulate colors properly');
          } else {
            details.push('✓ Script uses Color3/BrickColor');
          }

          // Check for wait/delay
          const hasWait = content.includes('wait') || content.includes('task.wait');
          if (!hasWait) {
            warnings.push('Script may not have timing delays');
          } else {
            details.push('✓ Script includes wait/delay');
          }

          // Check for idempotency (FindFirstChild, etc.)
          const isIdempotent =
            content.includes('findfirstchild') ||
            content.includes(':findfirst') ||
            content.includes('if not ');
          if (!isIdempotent) {
            warnings.push('Script may not be idempotent (should check for existing objects)');
          } else {
            details.push('✓ Script appears idempotent');
          }
        }
      }

      // 5. Check proposal count (should be concise)
      if (result.proposals.length > 5) {
        warnings.push(`Agent used ${result.proposals.length} proposals (should be more concise)`);
      }

      // 6. Check if completion was marked
      const isComplete = result.isComplete || result.proposals.some(p => p.type === 'completion');
      if (!isComplete) {
        warnings.push('Agent did not mark task as complete');
      }

      return {
        passed: errors.length === 0,
        errors,
        warnings,
        details
      };
    }
  },

  // ============================================================================
  // SCENARIO 2: Simple Geometry (No Script Policy Opt-Out)
  // Tests: Script policy enforcement
  // ============================================================================

  {
    name: 'Simple Part Creation',
    description: 'Tests that agent writes script even for simple geometry (script policy)',
    prompt: 'Create a red part at position (10, 5, 0) with size (4, 1, 4)',
    expectedTools: ['create_instance', 'apply_edit'],

    verify: (result) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const details: string[] = [];

      // Check geometry created
      const partCreated = result.proposals.some(p =>
        p.type === 'object_op' &&
        p.ops.some((op: any) => op.op === 'create_instance' && op.className === 'Part')
      );

      if (!partCreated) {
        errors.push('No Part created');
      } else {
        details.push('✓ Part created');
      }

      // Check script written (CRITICAL: script policy)
      const scriptWritten = result.proposals.some(p => p.type === 'edit');

      if (!scriptWritten) {
        errors.push('SCRIPT POLICY VIOLATION: No Luau script written for geometry');
        errors.push('Agent must write idempotent script that rebuilds geometry');
      } else {
        details.push('✓ Script written (complies with script policy)');

        // Check script quality
        const scriptFile = result.finalState.files.find((f: any) =>
          f[0].includes('Script')
        );

        if (scriptFile) {
          const [path, file] = scriptFile;
          const content = file.content.toLowerCase();

          // Check for Anchored property
          const hasAnchored = content.includes('anchored') || content.includes('anchored = true');
          if (!hasAnchored) {
            warnings.push('Script should explicitly set Anchored = true');
          } else {
            details.push('✓ Script sets Anchored property');
          }

          // Check for position (CFrame)
          const hasPosition = content.includes('cframe') || content.includes('position');
          if (!hasPosition) {
            warnings.push('Script should set position/CFrame');
          } else {
            details.push('✓ Script sets position');
          }

          // Check for size
          const hasSize = content.includes('size') || content.includes('vector3');
          if (!hasSize) {
            warnings.push('Script should set Size property');
          } else {
            details.push('✓ Script sets Size');
          }

          // Check for color
          const hasColor = content.includes('color') || content.includes('brickcolor');
          if (!hasColor) {
            warnings.push('Script should set Color property');
          } else {
            details.push('✓ Script sets Color');
          }

          // Check for idempotency
          const isIdempotent =
            content.includes('findfirstchild') ||
            content.includes('if ') ||
            content.includes('or ');
          if (!isIdempotent) {
            warnings.push('Script should be idempotent (check for existing part)');
          } else {
            details.push('✓ Script is idempotent');
          }
        }
      }

      return {
        passed: errors.length === 0,
        errors,
        warnings,
        details
      };
    }
  },

  // ============================================================================
  // SCENARIO 3: Asset-First Approach
  // Tests: Agent prefers assets over manual geometry
  // ============================================================================

  {
    name: 'Build Watch Tower',
    description: 'Tests that agent searches for assets before creating manual geometry',
    prompt: 'Build a military watch tower in the workspace',
    expectedTools: ['search_assets', 'insert_asset'],

    verify: (result) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const details: string[] = [];

      // Check if agent planned
      const hasPlan = result.taskState?.plan?.steps && result.taskState.plan.steps.length > 0;
      if (hasPlan) {
        details.push(`✓ Agent planned (${result.taskState.plan!.steps.length} steps)`);

        // Check if plan mentions assets
        const planText = result.taskState.plan!.steps.join(' ').toLowerCase();
        const mentionsAssets =
          planText.includes('search') ||
          planText.includes('asset') ||
          planText.includes('insert');

        if (mentionsAssets) {
          details.push('✓ Plan mentions asset search');
        } else {
          warnings.push('Plan should mention searching for assets');
        }
      }

      // Check if agent searched for assets
      const searchedAssets = result.toolCalls.some(tc => tc.tool === 'search_assets');

      if (!searchedAssets) {
        errors.push('Agent did not search for assets (should prefer assets over manual geometry)');
        errors.push('System prompt says: "Prefer search_assets → insert_asset for props/models"');
      } else {
        details.push('✓ Agent searched for assets');

        // Check search query quality
        const searchCall = result.toolCalls.find(tc => tc.tool === 'search_assets');
        if (searchCall) {
          const query = searchCall.params.query?.toLowerCase() || '';

          if (query.includes('tower') || query.includes('watchtower')) {
            details.push(`✓ Search query relevant: "${searchCall.params.query}"`);
          } else {
            warnings.push(`Search query may not be relevant: "${searchCall.params.query}"`);
          }

          // Check if tags provided
          if (searchCall.params.tags && searchCall.params.tags.length > 0) {
            details.push(`✓ Tags provided: ${searchCall.params.tags.join(', ')}`);
          }
        }
      }

      // Check if asset was inserted
      const insertedAsset = result.toolCalls.some(tc => tc.tool === 'insert_asset');

      if (searchedAssets && !insertedAsset) {
        warnings.push('Agent searched but did not insert an asset');
      } else if (insertedAsset) {
        details.push('✓ Asset inserted');
      }

      // Check if manual geometry was created
      const manualGeometry = result.proposals.some(p =>
        p.type === 'object_op' &&
        p.ops.some((op: any) =>
          op.op === 'create_instance' &&
          (op.className === 'Part' || op.className === 'WedgePart')
        )
      );

      if (manualGeometry && !insertedAsset) {
        warnings.push('Agent created manual geometry without trying assets first');
      }

      // Check script policy compliance
      if (manualGeometry) {
        const scriptWritten = result.proposals.some(p => p.type === 'edit');
        if (!scriptWritten) {
          errors.push('Manual geometry created but no script written (violates script policy)');
        }
      }

      return {
        passed: errors.length === 0,
        errors,
        warnings,
        details
      };
    }
  },

  // ============================================================================
  // SCENARIO 4: Scene Inspection
  // Tests: Agent checks existing scene before creating
  // ============================================================================

  {
    name: 'Avoid Duplicate Creation',
    description: 'Tests that agent checks scene before creating duplicates',
    prompt: 'Add a leaderboard to the game',
    expectedTools: ['list_children', 'create_instance', 'apply_edit'],

    setup: (env) => {
      // Pre-create a leaderboard
      env.createInstance('game.StarterGui', 'ScreenGui', 'Leaderboard', {
        Name: 'Leaderboard'
      });
    },

    verify: (result) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const details: string[] = [];

      // Check if agent inspected the scene
      const inspectedScene =
        result.toolCalls.some(tc => tc.tool === 'list_children') ||
        result.toolCalls.some(tc => tc.tool === 'get_properties');

      if (!inspectedScene) {
        warnings.push('Agent should inspect scene first (list_children) to check for existing objects');
      } else {
        details.push('✓ Agent inspected scene before creating');
      }

      // Check if agent created duplicate
      const createdScreenGui = result.proposals.some(p =>
        p.type === 'object_op' &&
        p.ops.some((op: any) =>
          op.op === 'create_instance' &&
          op.className === 'ScreenGui' &&
          (op.props?.Name === 'Leaderboard' || !op.props?.Name)
        )
      );

      if (createdScreenGui) {
        errors.push('Agent created duplicate ScreenGui named "Leaderboard" (should have detected existing one)');
      } else {
        details.push('✓ Agent did not create duplicate');
      }

      // Check if agent wrote script
      const scriptWritten = result.proposals.some(p => p.type === 'edit');

      if (!scriptWritten) {
        warnings.push('Agent should write leaderboard script (PlayerAdded, leaderstats, etc.)');
      } else {
        details.push('✓ Script written');

        // Check script content
        const scriptFile = result.finalState.files.find((f: any) =>
          f[0].includes('Script')
        );

        if (scriptFile) {
          const [path, file] = scriptFile;
          const content = file.content.toLowerCase();

          // Check for PlayerAdded event
          const hasPlayerAdded = content.includes('playeradded');
          if (!hasPlayerAdded) {
            warnings.push('Script should listen to PlayerAdded event');
          } else {
            details.push('✓ Script handles PlayerAdded');
          }

          // Check for leaderstats
          const hasLeaderstats = content.includes('leaderstats');
          if (!hasLeaderstats) {
            warnings.push('Script should create leaderstats folder');
          } else {
            details.push('✓ Script creates leaderstats');
          }
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
];
