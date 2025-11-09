#!/usr/bin/env node
/**
 * Vector Agent Test CLI
 *
 * Command-line interface for running Vector agent tests.
 * Executes tests against the real Vector API and generates comprehensive reports.
 *
 * Usage:
 *   npm run test:agent                    # Run all tests
 *   npm run test:agent -- --verbose       # Verbose output
 *   npm run test:agent -- --only=tool     # Run only tool tests
 *   npm run test:agent -- --json          # Generate JSON report
 *   npm run test:agent -- --html          # Generate HTML report
 *
 * @module scripts/test-agent
 */

import { TestRunner } from '../lib/testing/runner/test-runner';
import { JSONReporter } from '../lib/testing/reports/json-reporter';
import { HTMLReporter } from '../lib/testing/reports/html-reporter';
import * as path from 'path';

/**
 * CLI Options
 */
interface CLIOptions {
  verbose: boolean;
  baseUrl: string;
  timeout: number;
  skipTools: boolean;
  skipScenarios: boolean;
  onlyTests: string[];
  json: boolean;
  html: boolean;
  outputDir: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);

  const options: CLIOptions = {
    verbose: false,
    baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
    timeout: 60000,
    skipTools: false,
    skipScenarios: false,
    onlyTests: [],
    json: false,
    html: false,
    outputDir: path.join(process.cwd(), 'test-results')
  };

  for (const arg of args) {
    if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    }
    else if (arg === '--json') {
      options.json = true;
    }
    else if (arg === '--html') {
      options.html = true;
    }
    else if (arg === '--skip-tools') {
      options.skipTools = true;
    }
    else if (arg === '--skip-scenarios') {
      options.skipScenarios = true;
    }
    else if (arg.startsWith('--only=')) {
      const value = arg.split('=')[1];
      if (value === 'tool' || value === 'tools') {
        options.skipScenarios = true;
      } else if (value === 'scenario' || value === 'scenarios') {
        options.skipTools = true;
      } else {
        options.onlyTests = value.split(',');
      }
    }
    else if (arg.startsWith('--timeout=')) {
      options.timeout = parseInt(arg.split('=')[1], 10);
    }
    else if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.split('=')[1];
    }
    else if (arg.startsWith('--output=')) {
      options.outputDir = arg.split('=')[1];
    }
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Vector Agent Test CLI

Usage:
  npm run test:agent [options]

Options:
  -v, --verbose              Enable verbose logging
  --json                     Generate JSON report
  --html                     Generate HTML report
  --skip-tools              Skip individual tool tests
  --skip-scenarios          Skip scenario tests
  --only=<filter>           Run specific tests (tool, scenario, or test names)
  --timeout=<ms>            Test timeout in milliseconds (default: 60000)
  --base-url=<url>          API base URL (default: http://localhost:3000)
  --output=<dir>            Output directory for reports (default: ./test-results)
  -h, --help                Show this help message

Examples:
  npm run test:agent
  npm run test:agent -- --verbose
  npm run test:agent -- --only=tool
  npm run test:agent -- --json --html
  npm run test:agent -- --only=get_active_script,create_instance

Environment Variables:
  NEXT_PUBLIC_API_URL       API base URL (overridden by --base-url)
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('🧪 Vector Agent Testing Framework\n');

  // Parse arguments
  const options = parseArgs();

  // Validate environment
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error('❌ Error: No API key found in .env');
    console.error('   Please set ANTHROPIC_API_KEY or OPENAI_API_KEY');
    process.exit(1);
  }

  // Create test runner
  const runner = new TestRunner({
    verbose: options.verbose,
    baseUrl: options.baseUrl,
    timeout: options.timeout
  });

  try {
    // Run tests
    const result = await runner.runAll({
      skipTools: options.skipTools,
      skipScenarios: options.skipScenarios,
      onlyTests: options.onlyTests.length > 0 ? options.onlyTests : undefined
    });

    // Generate reports
    if (options.json) {
      const jsonPath = path.join(options.outputDir, 'test-results.json');
      await JSONReporter.save(result, jsonPath);
    }

    if (options.html) {
      const htmlPath = path.join(options.outputDir, 'test-results.html');
      await HTMLReporter.save(result, htmlPath);
    }

    // Exit with appropriate code
    process.exit(result.failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('\n❌ Fatal error running tests:');
    console.error(error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
