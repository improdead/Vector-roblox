/**
 * Test Runner
 *
 * Executes all Vector agent tests and generates comprehensive reports.
 * Runs both individual tool tests and real-world scenario tests.
 *
 * Features:
 * - Sequential test execution with detailed logging
 * - Pass/fail tracking with error reporting
 * - Performance metrics (duration, tool calls, etc.)
 * - Terminal output with colors and formatting
 * - Summary statistics and recommendations
 * - Verbose mode for debugging
 *
 * @module testing/runner/test-runner
 */

import { VirtualEnvironment } from './virtual-env';
import { AgentExecutor, ExecutionResult } from './agent-executor';
import { TOOL_TESTS, ToolTest } from '../tests/tool-tests';
import { SCENARIO_TESTS, ScenarioTest } from '../tests/scenario-tests';

/**
 * Result of running a single test
 */
export interface TestResult {
  testName: string;              // Name of the test
  testType: 'tool' | 'scenario'; // Type of test
  passed: boolean;               // Whether test passed
  duration: number;              // Execution time (ms)
  toolCalls: number;             // Number of tool calls made
  errors: string[];              // Error messages
  warnings: string[];            // Warning messages
  details: string[];             // Additional details
  executionResult?: ExecutionResult;  // Full execution result
}

/**
 * Complete test suite results
 */
export interface TestSuiteResult {
  totalTests: number;            // Total tests run
  passed: number;                // Tests that passed
  failed: number;                // Tests that failed
  duration: number;              // Total execution time (ms)
  toolTests: TestResult[];       // Individual tool test results
  scenarioTests: TestResult[];   // Scenario test results
  timestamp: Date;               // When tests were run
}

/**
 * Test Runner Options
 */
export interface TestRunnerOptions {
  verbose?: boolean;             // Enable detailed logging
  baseUrl?: string;              // API base URL
  timeout?: number;              // Test timeout (ms)
  skipTools?: boolean;           // Skip tool tests
  skipScenarios?: boolean;       // Skip scenario tests
  onlyTests?: string[];          // Run only specific tests
}

/**
 * Test Runner Class
 *
 * Orchestrates execution of all tests and generates reports.
 */
export class TestRunner {
  private verbose: boolean;
  private baseUrl: string;
  private timeout: number;

  /**
   * Create a new test runner
   * @param options - Runner configuration
   */
  constructor(options: TestRunnerOptions = {}) {
    this.verbose = options.verbose ?? false;
    this.baseUrl = options.baseUrl ?? 'http://localhost:3000';
    this.timeout = options.timeout ?? 60000;  // 60s default

    this.log('🧪 Test Runner initialized');
    this.log(`   Base URL: ${this.baseUrl}`);
    this.log(`   Timeout: ${this.timeout}ms`);
    this.log(`   Verbose: ${this.verbose}`);
  }

  /**
   * Run all tests
   * @param options - Execution options
   * @returns Complete test suite results
   */
  async runAll(options: TestRunnerOptions = {}): Promise<TestSuiteResult> {
    const startTime = Date.now();

    this.printHeader('VECTOR AGENT TEST SUITE');
    this.log(`Started at: ${new Date().toISOString()}\n`);

    const toolTests: TestResult[] = [];
    const scenarioTests: TestResult[] = [];

    // Run tool tests
    if (!options.skipTools) {
      this.printHeader('INDIVIDUAL TOOL TESTS', '=');
      for (const test of TOOL_TESTS) {
        if (options.onlyTests && !options.onlyTests.includes(test.name)) {
          this.log(`⏭️  Skipping: ${test.name}`);
          continue;
        }

        const result = await this.runToolTest(test);
        toolTests.push(result);

        // Show result
        this.printTestResult(result);
      }
    }

    // Run scenario tests
    if (!options.skipScenarios) {
      this.printHeader('SCENARIO TESTS', '=');
      for (const test of SCENARIO_TESTS) {
        if (options.onlyTests && !options.onlyTests.includes(test.name)) {
          this.log(`⏭️  Skipping: ${test.name}`);
          continue;
        }

        const result = await this.runScenarioTest(test);
        scenarioTests.push(result);

        // Show result
        this.printTestResult(result);
      }
    }

    const duration = Date.now() - startTime;

    // Calculate summary
    const allResults = [...toolTests, ...scenarioTests];
    const passed = allResults.filter(r => r.passed).length;
    const failed = allResults.filter(r => !r.passed).length;

    const suiteResult: TestSuiteResult = {
      totalTests: allResults.length,
      passed,
      failed,
      duration,
      toolTests,
      scenarioTests,
      timestamp: new Date()
    };

    // Print summary
    this.printSummary(suiteResult);

    return suiteResult;
  }

  /**
   * Run a single tool test
   * @param test - Tool test to run
   * @returns Test result
   */
  async runToolTest(test: ToolTest): Promise<TestResult> {
    this.log(`\n📝 Running: ${test.name}`);
    this.log(`   Description: ${test.description}`);
    this.log(`   Tool: ${test.tool}`);

    const startTime = Date.now();

    try {
      // Create virtual environment
      const env = new VirtualEnvironment(undefined, this.verbose);

      // Run setup if provided
      if (test.setup) {
        this.log('   🔧 Running setup...');
        test.setup(env);
      }

      // Create executor
      const executor = new AgentExecutor(env, this.verbose, this.baseUrl);

      // Execute prompt
      this.log(`   🤖 Executing prompt: "${test.prompt}"`);
      const executionResult = await executor.execute(test.prompt, {
        timeout: this.timeout,
        mode: 'agent',
        autoApply: true
      });

      // Verify result
      this.log('   ✅ Execution complete, verifying...');
      const verification = test.verify(executionResult);

      const duration = Date.now() - startTime;

      return {
        testName: test.name,
        testType: 'tool',
        passed: verification.passed,
        duration,
        toolCalls: executionResult.toolCalls.length,
        errors: verification.errors,
        warnings: verification.warnings,
        details: verification.details,
        executionResult
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      return {
        testName: test.name,
        testType: 'tool',
        passed: false,
        duration,
        toolCalls: 0,
        errors: [`Test execution failed: ${errorMsg}`],
        warnings: [],
        details: []
      };
    }
  }

  /**
   * Run a single scenario test
   * @param test - Scenario test to run
   * @returns Test result
   */
  async runScenarioTest(test: ScenarioTest): Promise<TestResult> {
    this.log(`\n📝 Running: ${test.name}`);
    this.log(`   Description: ${test.description}`);
    this.log(`   Expected tools: ${test.expectedTools.join(', ')}`);

    const startTime = Date.now();

    try {
      // Create virtual environment
      const env = new VirtualEnvironment(undefined, this.verbose);

      // Run setup if provided
      if (test.setup) {
        this.log('   🔧 Running setup...');
        test.setup(env);
      }

      // Create executor
      const executor = new AgentExecutor(env, this.verbose, this.baseUrl);

      // Execute prompt
      this.log(`   🤖 Executing prompt: "${test.prompt}"`);
      const executionResult = await executor.execute(test.prompt, {
        timeout: this.timeout * 2,  // Scenarios get 2x timeout
        mode: 'agent',
        autoApply: true
      });

      // Verify result
      this.log('   ✅ Execution complete, verifying...');
      const verification = test.verify(executionResult);

      const duration = Date.now() - startTime;

      return {
        testName: test.name,
        testType: 'scenario',
        passed: verification.passed,
        duration,
        toolCalls: executionResult.toolCalls.length,
        errors: verification.errors,
        warnings: verification.warnings,
        details: verification.details,
        executionResult
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      return {
        testName: test.name,
        testType: 'scenario',
        passed: false,
        duration,
        toolCalls: 0,
        errors: [`Test execution failed: ${errorMsg}`],
        warnings: [],
        details: []
      };
    }
  }

  /**
   * Print formatted header
   * @param title - Header title
   * @param char - Character to use for separator
   */
  private printHeader(title: string, char: string = '='): void {
    const width = 70;
    const separator = char.repeat(width);
    const padding = Math.floor((width - title.length - 2) / 2);
    const paddedTitle = ' '.repeat(padding) + title + ' '.repeat(padding);

    console.log('\n' + separator);
    console.log(paddedTitle);
    console.log(separator);
  }

  /**
   * Print test result
   * @param result - Test result to print
   */
  private printTestResult(result: TestResult): void {
    const icon = result.passed ? '✅' : '❌';
    const status = result.passed ? 'PASS' : 'FAIL';

    console.log(`\n${icon} ${result.testName} - ${status}`);
    console.log(`   Duration: ${result.duration}ms`);
    console.log(`   Tool calls: ${result.toolCalls}`);

    if (result.errors.length > 0) {
      console.log('\n   ❌ Errors:');
      for (const error of result.errors) {
        console.log(`      • ${error}`);
      }
    }

    if (result.warnings.length > 0) {
      console.log('\n   ⚠️  Warnings:');
      for (const warning of result.warnings) {
        console.log(`      • ${warning}`);
      }
    }

    if (this.verbose && result.details.length > 0) {
      console.log('\n   📊 Details:');
      for (const detail of result.details) {
        console.log(`      • ${detail}`);
      }
    }
  }

  /**
   * Print summary statistics
   * @param result - Test suite result
   */
  private printSummary(result: TestSuiteResult): void {
    this.printHeader('TEST SUMMARY');

    const passRate = result.totalTests > 0
      ? ((result.passed / result.totalTests) * 100).toFixed(1)
      : '0.0';

    console.log(`\n📊 Results:`);
    console.log(`   Total tests: ${result.totalTests}`);
    console.log(`   ✅ Passed: ${result.passed}`);
    console.log(`   ❌ Failed: ${result.failed}`);
    console.log(`   📈 Pass rate: ${passRate}%`);
    console.log(`   ⏱️  Total duration: ${result.duration}ms (${(result.duration / 1000).toFixed(1)}s)`);

    if (result.toolTests.length > 0) {
      const toolPassed = result.toolTests.filter(t => t.passed).length;
      console.log(`\n🔧 Tool Tests: ${toolPassed}/${result.toolTests.length} passed`);
    }

    if (result.scenarioTests.length > 0) {
      const scenarioPassed = result.scenarioTests.filter(t => t.passed).length;
      console.log(`🎬 Scenario Tests: ${scenarioPassed}/${result.scenarioTests.length} passed`);
    }

    // Failed tests
    const failed = [...result.toolTests, ...result.scenarioTests].filter(t => !t.passed);
    if (failed.length > 0) {
      console.log(`\n❌ Failed Tests:`);
      for (const test of failed) {
        console.log(`   • ${test.testName}`);
        for (const error of test.errors) {
          console.log(`     - ${error}`);
        }
      }
    }

    // Performance insights
    console.log(`\n⚡ Performance:`);
    const avgDuration = result.totalTests > 0
      ? Math.round(result.duration / result.totalTests)
      : 0;
    console.log(`   Average test duration: ${avgDuration}ms`);

    const totalToolCalls = [...result.toolTests, ...result.scenarioTests]
      .reduce((sum, t) => sum + t.toolCalls, 0);
    const avgToolCalls = result.totalTests > 0
      ? (totalToolCalls / result.totalTests).toFixed(1)
      : '0.0';
    console.log(`   Average tool calls: ${avgToolCalls}`);

    // Recommendations
    if (result.failed > 0) {
      console.log(`\n💡 Recommendations:`);
      console.log(`   • Review failed tests above for specific error messages`);
      console.log(`   • Run with --verbose flag for detailed execution logs`);
      console.log(`   • Check API connectivity at ${this.baseUrl}`);
      console.log(`   • Verify .env configuration is correct`);
    }

    console.log('');
  }

  /**
   * Log a message if verbose mode is enabled
   * @param message - Message to log
   */
  private log(message: string): void {
    if (this.verbose) {
      console.log(`[TestRunner] ${message}`);
    }
  }
}
