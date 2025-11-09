/**
 * JSON Reporter
 *
 * Generates JSON report files from test suite results.
 * Creates machine-readable output for CI/CD integration and automated analysis.
 *
 * Features:
 * - Complete test suite results in JSON format
 * - Individual test details with errors and warnings
 * - Performance metrics and statistics
 * - Execution results for debugging
 *
 * @module testing/reports/json-reporter
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestSuiteResult, TestResult } from '../runner/test-runner';

/**
 * JSON Report Format
 */
export interface JSONReport {
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    passRate: number;
    duration: number;
    timestamp: string;
  };
  toolTests: TestResultJSON[];
  scenarioTests: TestResultJSON[];
  performance: {
    avgDuration: number;
    avgToolCalls: number;
    totalToolCalls: number;
  };
  failures: {
    testName: string;
    errors: string[];
    warnings: string[];
  }[];
}

/**
 * JSON Test Result Format
 */
export interface TestResultJSON {
  name: string;
  type: 'tool' | 'scenario';
  passed: boolean;
  duration: number;
  toolCalls: number;
  errors: string[];
  warnings: string[];
  details: string[];
}

/**
 * JSON Reporter Class
 */
export class JSONReporter {
  /**
   * Generate JSON report from test suite results
   * @param result - Test suite result
   * @returns JSON report object
   */
  static generate(result: TestSuiteResult): JSONReport {
    const passRate = result.totalTests > 0
      ? (result.passed / result.totalTests) * 100
      : 0;

    const allTests = [...result.toolTests, ...result.scenarioTests];
    const totalToolCalls = allTests.reduce((sum, t) => sum + t.toolCalls, 0);
    const avgDuration = result.totalTests > 0
      ? result.duration / result.totalTests
      : 0;
    const avgToolCalls = result.totalTests > 0
      ? totalToolCalls / result.totalTests
      : 0;

    const failures = allTests
      .filter(t => !t.passed)
      .map(t => ({
        testName: t.testName,
        errors: t.errors,
        warnings: t.warnings
      }));

    return {
      summary: {
        totalTests: result.totalTests,
        passed: result.passed,
        failed: result.failed,
        passRate: parseFloat(passRate.toFixed(2)),
        duration: result.duration,
        timestamp: result.timestamp.toISOString()
      },
      toolTests: result.toolTests.map(this.formatTestResult),
      scenarioTests: result.scenarioTests.map(this.formatTestResult),
      performance: {
        avgDuration: Math.round(avgDuration),
        avgToolCalls: parseFloat(avgToolCalls.toFixed(2)),
        totalToolCalls
      },
      failures
    };
  }

  /**
   * Save JSON report to file
   * @param result - Test suite result
   * @param outputPath - Output file path
   */
  static async save(result: TestSuiteResult, outputPath: string): Promise<void> {
    const report = this.generate(result);

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write file
    const json = JSON.stringify(report, null, 2);
    fs.writeFileSync(outputPath, json, 'utf-8');

    console.log(`📄 JSON report saved to: ${outputPath}`);
  }

  /**
   * Format test result for JSON output
   * @param result - Test result
   * @returns JSON-formatted test result
   */
  private static formatTestResult(result: TestResult): TestResultJSON {
    return {
      name: result.testName,
      type: result.testType,
      passed: result.passed,
      duration: result.duration,
      toolCalls: result.toolCalls,
      errors: result.errors,
      warnings: result.warnings,
      details: result.details
    };
  }
}
