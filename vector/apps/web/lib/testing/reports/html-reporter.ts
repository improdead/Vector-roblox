/**
 * HTML Reporter
 *
 * Generates beautiful HTML report files from test suite results.
 * Creates human-readable output with styling and interactive elements.
 *
 * Features:
 * - Visual pass/fail indicators
 * - Expandable test details
 * - Performance charts and metrics
 * - Color-coded errors and warnings
 * - Responsive design
 *
 * @module testing/reports/html-reporter
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestSuiteResult, TestResult } from '../runner/test-runner';

/**
 * HTML Reporter Class
 */
export class HTMLReporter {
  /**
   * Generate HTML report from test suite results
   * @param result - Test suite result
   * @returns HTML string
   */
  static generate(result: TestSuiteResult): string {
    const passRate = result.totalTests > 0
      ? ((result.passed / result.totalTests) * 100).toFixed(1)
      : '0.0';

    const allTests = [...result.toolTests, ...result.scenarioTests];
    const totalToolCalls = allTests.reduce((sum, t) => sum + t.toolCalls, 0);
    const avgDuration = result.totalTests > 0
      ? Math.round(result.duration / result.totalTests)
      : 0;
    const avgToolCalls = result.totalTests > 0
      ? (totalToolCalls / result.totalTests).toFixed(1)
      : '0.0';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vector Agent Test Report</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      padding: 20px;
      line-height: 1.6;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }

    header h1 {
      font-size: 2em;
      margin-bottom: 10px;
    }

    header .timestamp {
      opacity: 0.9;
      font-size: 0.9em;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      padding: 30px;
      background: #f9fafb;
      border-bottom: 2px solid #e5e7eb;
    }

    .stat-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .stat-card .label {
      color: #6b7280;
      font-size: 0.9em;
      margin-bottom: 8px;
    }

    .stat-card .value {
      font-size: 2em;
      font-weight: bold;
      color: #1f2937;
    }

    .stat-card.passed .value {
      color: #10b981;
    }

    .stat-card.failed .value {
      color: #ef4444;
    }

    .section {
      padding: 30px;
    }

    .section-title {
      font-size: 1.5em;
      margin-bottom: 20px;
      color: #1f2937;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 10px;
    }

    .test-list {
      display: flex;
      flex-direction: column;
      gap: 15px;
    }

    .test-item {
      background: #f9fafb;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #e5e7eb;
    }

    .test-item.passed {
      border-left: 4px solid #10b981;
    }

    .test-item.failed {
      border-left: 4px solid #ef4444;
    }

    .test-header {
      padding: 15px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      transition: background 0.2s;
    }

    .test-header:hover {
      background: #f3f4f6;
    }

    .test-name {
      font-weight: 600;
      color: #1f2937;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .test-badge {
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: 600;
    }

    .test-badge.passed {
      background: #d1fae5;
      color: #065f46;
    }

    .test-badge.failed {
      background: #fee2e2;
      color: #991b1b;
    }

    .test-badge.tool {
      background: #dbeafe;
      color: #1e40af;
    }

    .test-badge.scenario {
      background: #fef3c7;
      color: #92400e;
    }

    .test-meta {
      display: flex;
      gap: 20px;
      color: #6b7280;
      font-size: 0.9em;
    }

    .test-details {
      padding: 0 20px 20px;
      display: none;
    }

    .test-item.expanded .test-details {
      display: block;
    }

    .detail-section {
      margin-top: 15px;
    }

    .detail-section h4 {
      color: #374151;
      margin-bottom: 8px;
      font-size: 0.95em;
    }

    .detail-list {
      list-style: none;
      padding: 0;
    }

    .detail-list li {
      padding: 6px 12px;
      margin: 4px 0;
      border-radius: 4px;
      font-size: 0.9em;
    }

    .detail-list.errors li {
      background: #fee2e2;
      color: #991b1b;
    }

    .detail-list.warnings li {
      background: #fef3c7;
      color: #92400e;
    }

    .detail-list.info li {
      background: #f3f4f6;
      color: #4b5563;
    }

    footer {
      padding: 20px;
      text-align: center;
      color: #6b7280;
      font-size: 0.9em;
      border-top: 1px solid #e5e7eb;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🧪 Vector Agent Test Report</h1>
      <div class="timestamp">${result.timestamp.toLocaleString()}</div>
    </header>

    <div class="summary">
      <div class="stat-card">
        <div class="label">Total Tests</div>
        <div class="value">${result.totalTests}</div>
      </div>
      <div class="stat-card passed">
        <div class="label">Passed</div>
        <div class="value">✅ ${result.passed}</div>
      </div>
      <div class="stat-card failed">
        <div class="label">Failed</div>
        <div class="value">❌ ${result.failed}</div>
      </div>
      <div class="stat-card">
        <div class="label">Pass Rate</div>
        <div class="value">${passRate}%</div>
      </div>
      <div class="stat-card">
        <div class="label">Duration</div>
        <div class="value">${(result.duration / 1000).toFixed(1)}s</div>
      </div>
      <div class="stat-card">
        <div class="label">Avg Tool Calls</div>
        <div class="value">${avgToolCalls}</div>
      </div>
    </div>

    ${result.toolTests.length > 0 ? `
    <div class="section">
      <h2 class="section-title">🔧 Tool Tests (${result.toolTests.filter(t => t.passed).length}/${result.toolTests.length})</h2>
      <div class="test-list">
        ${result.toolTests.map(test => this.generateTestHTML(test)).join('\n')}
      </div>
    </div>
    ` : ''}

    ${result.scenarioTests.length > 0 ? `
    <div class="section">
      <h2 class="section-title">🎬 Scenario Tests (${result.scenarioTests.filter(t => t.passed).length}/${result.scenarioTests.length})</h2>
      <div class="test-list">
        ${result.scenarioTests.map(test => this.generateTestHTML(test)).join('\n')}
      </div>
    </div>
    ` : ''}

    <footer>
      Generated by Vector Agent Testing Framework
    </footer>
  </div>

  <script>
    // Toggle test details
    document.querySelectorAll('.test-header').forEach(header => {
      header.addEventListener('click', () => {
        header.parentElement.classList.toggle('expanded');
      });
    });
  </script>
</body>
</html>`;
  }

  /**
   * Generate HTML for a single test
   * @param test - Test result
   * @returns HTML string
   */
  private static generateTestHTML(test: TestResult): string {
    const statusClass = test.passed ? 'passed' : 'failed';
    const statusText = test.passed ? 'PASS' : 'FAIL';
    const typeClass = test.testType;
    const typeText = test.testType.toUpperCase();

    return `
    <div class="test-item ${statusClass}">
      <div class="test-header">
        <div class="test-name">
          <span>${test.testName}</span>
          <span class="test-badge ${statusClass}">${statusText}</span>
          <span class="test-badge ${typeClass}">${typeText}</span>
        </div>
        <div class="test-meta">
          <span>⏱️ ${test.duration}ms</span>
          <span>🔧 ${test.toolCalls} calls</span>
        </div>
      </div>
      <div class="test-details">
        ${test.errors.length > 0 ? `
        <div class="detail-section">
          <h4>❌ Errors</h4>
          <ul class="detail-list errors">
            ${test.errors.map(e => `<li>${this.escapeHTML(e)}</li>`).join('\n')}
          </ul>
        </div>
        ` : ''}

        ${test.warnings.length > 0 ? `
        <div class="detail-section">
          <h4>⚠️ Warnings</h4>
          <ul class="detail-list warnings">
            ${test.warnings.map(w => `<li>${this.escapeHTML(w)}</li>`).join('\n')}
          </ul>
        </div>
        ` : ''}

        ${test.details.length > 0 ? `
        <div class="detail-section">
          <h4>📊 Details</h4>
          <ul class="detail-list info">
            ${test.details.map(d => `<li>${this.escapeHTML(d)}</li>`).join('\n')}
          </ul>
        </div>
        ` : ''}
      </div>
    </div>`;
  }

  /**
   * Escape HTML special characters
   * @param text - Text to escape
   * @returns Escaped text
   */
  private static escapeHTML(text: string): string {
    const div = { textContent: text } as any;
    const element = document.createElement ? document.createElement('div') : div;
    element.textContent = text;
    return element.innerHTML || text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Save HTML report to file
   * @param result - Test suite result
   * @param outputPath - Output file path
   */
  static async save(result: TestSuiteResult, outputPath: string): Promise<void> {
    const html = this.generate(result);

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write file
    fs.writeFileSync(outputPath, html, 'utf-8');

    console.log(`📄 HTML report saved to: ${outputPath}`);
  }
}
