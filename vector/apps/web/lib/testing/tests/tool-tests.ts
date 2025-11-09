/**
 * Tool Tests
 *
 * Simplified tests that verify the agent can handle basic requests.
 * These are less important than scenario tests which verify intelligence.
 *
 * The main goal is to ensure the API integration works correctly.
 * Detailed intelligence testing is done in scenario-tests.ts.
 *
 * @module testing/tests/tool-tests
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
 * Individual tool test definition
 */
export interface ToolTest {
  name: string;
  description: string;
  tool: string;
  prompt: string;
  setup?: (env: VirtualEnvironment) => void;
  verify: (result: ExecutionResult) => TestVerification;
}

/**
 * All individual tool tests
 */
export const TOOL_TESTS: ToolTest[] = [
  // Simple test to verify basic agent functionality
  {
    name: 'Create Instance',
    description: 'Tests that agent can create a basic instance',
    tool: 'create_instance',
    prompt: 'Create a Part named TestPart in Workspace',

    verify: (result) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const details: string[] = [];

      // Check if proposals were generated
      if (result.proposals.length === 0) {
        errors.push('No proposals generated');
        return { passed: false, errors, warnings, details };
      }

      details.push(`✓ ${result.proposals.length} proposal(s) generated`);

      // Check if part was created
      const partCreated = result.finalState.instances.some((i: any) => {
        const [path, instance] = i;
        return instance.name === 'TestPart' && instance.className === 'Part';
      });

      if (!partCreated) {
        errors.push('Part "TestPart" was not created in final state');
      } else {
        details.push('✓ Part created successfully');
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
