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
 * Intelligence tests (1-4) use AI review with GPT-4o-mini.
 * Geometry quality tests (5-7) use programmatic verification only.
 *
 * @module testing/tests/scenario-tests
 */

import { VirtualEnvironment } from '../runner/virtual-env';
import { ExecutionResult } from '../runner/agent-executor';
import { reviewWithAI, isAIReviewEnabled } from '../runner/ai-reviewer';

/**
 * Test verification result
 */
export interface TestVerification {
  passed: boolean;
  errors: string[];
  warnings: string[];
  details: string[];
  aiReview?: {
    score: number;
    reasoning: string;
    insights: string[];
  };
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
  verify: (result: ExecutionResult) => TestVerification | Promise<TestVerification>;
  useAIReview?: boolean; // Enable AI review for this test
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
    useAIReview: true,

    verify: async (result) => {
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

      // 7. AI Review (if enabled)
      let aiReview = undefined;
      if (isAIReviewEnabled()) {
        const review = await reviewWithAI(result);

        // Add AI review insights to details
        if (review.insights.length > 0) {
          details.push('', '🤖 AI Review Insights:');
          review.insights.forEach(insight => details.push(`  • ${insight}`));
        }

        // Add AI issues to errors if review failed
        if (!review.passed) {
          errors.push('', '🤖 AI Review Issues:');
          review.issues.forEach(issue => errors.push(`  • ${issue}`));
        }

        aiReview = {
          score: review.score,
          reasoning: review.reasoning,
          insights: review.insights
        };
      }

      return {
        passed: errors.length === 0,
        errors,
        warnings,
        details,
        aiReview
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
    useAIReview: true,

    verify: async (result) => {
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

      // AI Review (if enabled)
      let aiReview = undefined;
      if (isAIReviewEnabled()) {
        const review = await reviewWithAI(result);

        if (review.insights.length > 0) {
          details.push('', '🤖 AI Review Insights:');
          review.insights.forEach(insight => details.push(`  • ${insight}`));
        }

        if (!review.passed) {
          errors.push('', '🤖 AI Review Issues:');
          review.issues.forEach(issue => errors.push(`  • ${issue}`));
        }

        aiReview = {
          score: review.score,
          reasoning: review.reasoning,
          insights: review.insights
        };
      }

      return {
        passed: errors.length === 0,
        errors,
        warnings,
        details,
        aiReview
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
    useAIReview: true,

    verify: async (result) => {
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

      // AI Review (if enabled)
      let aiReview = undefined;
      if (isAIReviewEnabled()) {
        const review = await reviewWithAI(result);

        if (review.insights.length > 0) {
          details.push('', '🤖 AI Review Insights:');
          review.insights.forEach(insight => details.push(`  • ${insight}`));
        }

        if (!review.passed) {
          errors.push('', '🤖 AI Review Issues:');
          review.issues.forEach(issue => errors.push(`  • ${issue}`));
        }

        aiReview = {
          score: review.score,
          reasoning: review.reasoning,
          insights: review.insights
        };
      }

      return {
        passed: errors.length === 0,
        errors,
        warnings,
        details,
        aiReview
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
    useAIReview: true,

    setup: (env) => {
      // Pre-create a leaderboard
      env.createInstance('game.StarterGui', 'ScreenGui', 'Leaderboard', {
        Name: 'Leaderboard'
      });
    },

    verify: async (result) => {
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

      // AI Review (if enabled)
      let aiReview = undefined;
      if (isAIReviewEnabled()) {
        const review = await reviewWithAI(result);

        if (review.insights.length > 0) {
          details.push('', '🤖 AI Review Insights:');
          review.insights.forEach(insight => details.push(`  • ${insight}`));
        }

        if (!review.passed) {
          errors.push('', '🤖 AI Review Issues:');
          review.issues.forEach(issue => errors.push(`  • ${issue}`));
        }

        aiReview = {
          score: review.score,
          reasoning: review.reasoning,
          insights: review.insights
        };
      }

      return {
        passed: errors.length === 0,
        errors,
        warnings,
        details,
        aiReview
      };
    }
  },

  // ============================================================================
  // SCENARIO 5: Geometry Quality - Simple Structure
  // Tests: Proper positioning, anchoring, sizing, materials
  // ============================================================================

  {
    name: 'Build Simple House Structure',
    description: 'Tests geometry quality: positioning, anchoring, sizing, materials, hierarchy',
    prompt: 'Build a simple house with a floor (16x1x16), four walls (each 1 unit thick), and a roof',
    expectedTools: ['create_instance', 'apply_edit'],

    verify: (result) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const details: string[] = [];

      // Check if structure was created with proper hierarchy
      const instances = result.finalState.instances;

      // Look for parent container (Model or Folder)
      const hasContainer = instances.some((i: any) => {
        const [path, inst] = i;
        return (inst.className === 'Model' || inst.className === 'Folder') &&
               (inst.name.toLowerCase().includes('house') ||
                inst.name.toLowerCase().includes('structure'));
      });

      if (!hasContainer) {
        warnings.push('Should create parent Model/Folder to organize parts');
      } else {
        details.push('✓ Created parent container for organization');
      }

      // Check for multiple parts (floor + walls + roof = at least 6 parts)
      const parts = instances.filter((i: any) => {
        const [path, inst] = i;
        return inst.className === 'Part' || inst.className === 'WedgePart';
      });

      if (parts.length < 5) {
        errors.push(`Only created ${parts.length} parts (expected at least 5 for floor + 4 walls)`);
      } else {
        details.push(`✓ Created ${parts.length} parts`);
      }

      // Check geometry properties in created instances
      let hasAnchored = false;
      let hasProperSize = false;
      let hasCFrame = false;
      let hasMaterial = false;

      for (const [path, inst] of parts) {
        const props = inst.properties;

        // Check Anchored
        if (props.Anchored === true) {
          hasAnchored = true;
        }

        // Check Size (should have Vector3 with reasonable dimensions)
        if (props.Size && typeof props.Size === 'object') {
          const size = props.Size;
          if ((size.__t === 'Vector3' || size.x !== undefined) &&
              size.x > 0 && size.y > 0 && size.z > 0) {
            hasProperSize = true;
          }
        }

        // Check CFrame (positioning)
        if (props.CFrame && typeof props.CFrame === 'object') {
          hasCFrame = true;
        }

        // Check Material
        if (props.Material) {
          hasMaterial = true;
        }
      }

      if (!hasAnchored) {
        errors.push('Parts should be Anchored (no Anchored=true found in properties)');
      } else {
        details.push('✓ Parts are anchored');
      }

      if (!hasProperSize) {
        errors.push('Parts should have proper Size property (Vector3)');
      } else {
        details.push('✓ Parts have proper sizes');
      }

      if (!hasCFrame) {
        warnings.push('Parts should have CFrame for positioning');
      } else {
        details.push('✓ Parts have CFrame positioning');
      }

      if (!hasMaterial) {
        warnings.push('Parts should have Material property for appearance');
      } else {
        details.push('✓ Parts have materials set');
      }

      // Check script quality
      const scriptWritten = result.proposals.some(p => p.type === 'edit');

      if (!scriptWritten) {
        errors.push('No script written (violates script policy for geometry)');
      } else {
        details.push('✓ Script written');

        const scriptFile = result.finalState.files.find((f: any) =>
          f[0].includes('Script')
        );

        if (scriptFile) {
          const [path, file] = scriptFile;
          const content = file.content.toLowerCase();

          // Check for proper structure creation in script
          const hasInstanceNew = content.includes('instance.new');
          const hasCFrameNew = content.includes('cframe.new') || content.includes('cframe.from');
          const hasVector3New = content.includes('vector3.new');
          const hasParenting = content.includes('.parent =') || content.includes('.parent=');

          if (!hasInstanceNew) {
            warnings.push('Script should use Instance.new() to create parts');
          } else {
            details.push('✓ Script uses Instance.new()');
          }

          if (!hasCFrameNew) {
            warnings.push('Script should use CFrame.new() for positioning');
          } else {
            details.push('✓ Script uses CFrame positioning');
          }

          if (!hasVector3New) {
            warnings.push('Script should use Vector3.new() for sizes');
          } else {
            details.push('✓ Script uses Vector3 for sizes');
          }

          if (!hasParenting) {
            warnings.push('Script should set .Parent property');
          } else {
            details.push('✓ Script sets parent relationships');
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
  // SCENARIO 6: Complex Geometry - Proper Alignment
  // Tests: Alignment, spacing, rotation, precise positioning
  // ============================================================================

  {
    name: 'Create Aligned Part Grid',
    description: 'Tests precise positioning, alignment, and spacing in geometry',
    prompt: 'Create a 3x3 grid of colored parts, each 4x4x4 studs, spaced 2 studs apart, all at Y=2',
    expectedTools: ['create_instance', 'apply_edit'],

    verify: (result) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const details: string[] = [];

      // Check if script was written
      const scriptWritten = result.proposals.some(p => p.type === 'edit');

      if (!scriptWritten) {
        errors.push('No script written (violates script policy)');
        return { passed: false, errors, warnings, details };
      }

      const scriptFile = result.finalState.files.find((f: any) =>
        f[0].includes('Script')
      );

      if (!scriptFile) {
        errors.push('Script file not found in final state');
        return { passed: false, errors, warnings, details };
      }

      const [path, file] = scriptFile;
      const content = file.content.toLowerCase();

      // Check for loop structure (should use loops for grid)
      const hasLoop =
        (content.includes('for ') && content.includes('do')) ||
        content.includes('while');

      if (!hasLoop) {
        warnings.push('Should use loops (for i = 1, 3) for creating grid efficiently');
      } else {
        details.push('✓ Uses loop structure for grid');
      }

      // Check for proper positioning logic
      const hasPositionCalc =
        content.includes('*') || // Multiplication for spacing
        content.includes('+') || // Addition for offset
        content.includes('-');   // Subtraction for centering

      if (!hasPositionCalc) {
        warnings.push('Should calculate positions using math operations');
      } else {
        details.push('✓ Calculates positions programmatically');
      }

      // Check for consistent Y position
      const mentionsY2 = content.includes('y = 2') || content.includes('y=2');

      if (!mentionsY2) {
        warnings.push('Should set consistent Y position (Y=2)');
      } else {
        details.push('✓ Uses consistent Y position');
      }

      // Check for spacing logic
      const mentionsSpacing =
        content.includes('spacing') ||
        content.includes('gap') ||
        content.includes('offset');

      if (mentionsSpacing) {
        details.push('✓ Considers spacing in logic');
      }

      // Check for color variation
      const hasColorLogic =
        content.includes('color3') ||
        content.includes('brickcolor') ||
        content.includes('color =');

      if (!hasColorLogic) {
        warnings.push('Should vary colors for grid parts');
      } else {
        details.push('✓ Includes color variation');
      }

      // Check for proper size setting (4x4x4)
      const mentionsSize4 = content.includes('4, 4, 4') || content.includes('4,4,4');

      if (mentionsSize4) {
        details.push('✓ Uses correct size (4x4x4)');
      }

      // Check instances created
      const parts = result.finalState.instances.filter((i: any) => {
        const [path, inst] = i;
        return inst.className === 'Part';
      });

      if (parts.length < 9) {
        warnings.push(`Only created ${parts.length} parts (expected 9 for 3x3 grid)`);
      } else if (parts.length === 9) {
        details.push('✓ Created exactly 9 parts for 3x3 grid');
      } else {
        details.push(`✓ Created ${parts.length} parts`);
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
  // SCENARIO 7: Advanced Geometry - Rotation and Complex Shapes
  // Tests: CFrame rotation, WedgeParts, compound shapes
  // ============================================================================

  {
    name: 'Build Ramp or Stairs',
    description: 'Tests rotation, WedgeParts, and complex geometry assembly',
    prompt: 'Build a ramp or staircase going up 10 studs over 20 studs distance',
    expectedTools: ['create_instance', 'apply_edit'],

    verify: (result) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const details: string[] = [];

      // Check if script was written
      const scriptWritten = result.proposals.some(p => p.type === 'edit');

      if (!scriptWritten) {
        errors.push('No script written (violates script policy)');
        return { passed: false, errors, warnings, details };
      }

      const scriptFile = result.finalState.files.find((f: any) =>
        f[0].includes('Script')
      );

      if (!scriptFile) {
        errors.push('Script file not found');
        return { passed: false, errors, warnings, details };
      }

      const [path, file] = scriptFile;
      const content = file.content.toLowerCase();

      // Check for WedgePart usage (common for ramps)
      const usesWedge = content.includes('wedgepart');

      if (usesWedge) {
        details.push('✓ Uses WedgePart (appropriate for ramps)');
      }

      // Check for rotation/CFrame manipulation
      const hasRotation =
        content.includes('cframe.angles') ||
        content.includes('cframe.fromaxisangle') ||
        content.includes('cframe.fromeulerangle') ||
        content.includes('rotation');

      if (!hasRotation && usesWedge) {
        warnings.push('Should use CFrame.Angles or rotation for proper wedge orientation');
      } else if (hasRotation) {
        details.push('✓ Uses CFrame rotation');
      }

      // Check for proper incremental positioning (for stairs)
      const hasIncrement =
        (content.includes('for ') &&
         (content.includes('+=') || content.includes('+ '))) ||
        content.includes('step');

      if (hasIncrement) {
        details.push('✓ Uses incremental positioning (good for stairs)');
      }

      // Check for proper anchoring
      const hasAnchored = content.includes('anchored = true') || content.includes('anchored=true');

      if (!hasAnchored) {
        warnings.push('Parts should be anchored');
      } else {
        details.push('✓ Parts are anchored');
      }

      // Check instances created
      const instances = result.finalState.instances.filter((i: any) => {
        const [path, inst] = i;
        return inst.className === 'Part' || inst.className === 'WedgePart';
      });

      if (instances.length < 1) {
        errors.push('No parts/wedges created');
      } else {
        details.push(`✓ Created ${instances.length} geometric instances`);
      }

      // Verify proper vertical rise
      const mentions10Studs = content.includes('10') && (content.includes('height') || content.includes('rise') || content.includes('y'));

      if (mentions10Studs) {
        details.push('✓ Accounts for 10 stud vertical rise');
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
