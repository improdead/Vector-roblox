/**
 * User-Friendly Error Handling System
 * Fix for Issue #4: Basic Error Messages
 *
 * Transforms technical errors into actionable, user-friendly messages
 * with suggestions and quick fixes to guide users toward solutions.
 */

export interface UserFriendlyError {
  /** Human-readable description of the error */
  message: string;

  /** Actionable suggestion for the user */
  suggestion: string;

  /** Quick fix actions the user can take */
  quickFixes: QuickFix[];

  /** Original technical error for debugging */
  technical?: string;

  /** Error severity level */
  severity: 'error' | 'warning' | 'info';

  /** Error category for better organization */
  category: ErrorCategory;

  /** Help documentation link */
  helpUrl?: string;

  /** Related errors or context */
  relatedErrors?: string[];
}

export interface QuickFix {
  /** Display label for the quick fix */
  label: string;

  /** Description of what this fix does */
  description?: string;

  /** Action to execute when selected */
  action: () => void | Promise<void>;

  /** Whether this fix is automatic (no user confirmation needed) */
  automatic?: boolean;

  /** Icon or emoji to display */
  icon?: string;
}

export enum ErrorCategory {
  Validation = 'validation',
  Network = 'network',
  Authentication = 'authentication',
  Permission = 'permission',
  FileSystem = 'filesystem',
  Syntax = 'syntax',
  Runtime = 'runtime',
  Configuration = 'configuration',
  API = 'api',
  Unknown = 'unknown',
}

/**
 * Enhanced error handler with user-friendly messages and quick fixes
 */
export class ErrorHandler {
  private errorHandlers: Map<string, ErrorTransformer> = new Map();
  private errorHistory: UserFriendlyError[] = [];
  private maxHistorySize: number = 50;

  constructor() {
    this.registerDefaultHandlers();
  }

  /**
   * Handle an error and transform it into user-friendly format
   */
  handle(error: Error | string): UserFriendlyError {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Try to match against registered handlers
    for (const [pattern, transformer] of this.errorHandlers) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(errorMessage)) {
        const friendly = transformer(errorMessage, errorStack);
        this.addToHistory(friendly);
        return friendly;
      }
    }

    // Fallback to generic error
    const genericError = this.createGenericError(errorMessage, errorStack);
    this.addToHistory(genericError);
    return genericError;
  }

  /**
   * Register a custom error handler
   */
  registerHandler(pattern: string, transformer: ErrorTransformer): void {
    this.errorHandlers.set(pattern, transformer);
  }

  /**
   * Get error history
   */
  getHistory(): UserFriendlyError[] {
    return [...this.errorHistory];
  }

  /**
   * Clear error history
   */
  clearHistory(): void {
    this.errorHistory = [];
  }

  /**
   * Register default error handlers for common cases
   */
  private registerDefaultHandlers(): void {
    // Validation errors
    this.registerHandler('VALIDATION_ERROR|validation failed', (msg) => ({
      message: "The request couldn't be processed due to invalid input",
      suggestion: 'Check that all required parameters are provided correctly',
      quickFixes: [
        {
          label: 'Select an active script',
          description: 'Ensure you have a script selected in Roblox Studio',
          action: () => this.selectActiveScript(),
          icon: '📝',
        },
        {
          label: 'Retry with simpler request',
          description: 'Try breaking down your request into smaller steps',
          action: () => this.simplifyRequest(),
          icon: '🔄',
        },
        {
          label: 'View examples',
          description: 'See examples of valid requests',
          action: () => this.showExamples(),
          icon: '📚',
        },
      ],
      technical: msg,
      severity: 'error',
      category: ErrorCategory.Validation,
      helpUrl: 'https://docs.vector.dev/errors/validation',
    }));

    // Network errors
    this.registerHandler('ECONNREFUSED|ETIMEDOUT|network error|fetch failed', (msg) => ({
      message: 'Unable to connect to the Vector backend',
      suggestion: 'Make sure the backend server is running and accessible',
      quickFixes: [
        {
          label: 'Check backend status',
          description: 'Verify the backend is running on http://127.0.0.1:3000',
          action: () => this.checkBackendStatus(),
          icon: '🔍',
        },
        {
          label: 'Restart backend',
          description: 'Restart the Vector backend server',
          action: () => this.restartBackend(),
          icon: '🔄',
        },
        {
          label: 'Check firewall',
          description: 'Ensure firewall isn\'t blocking port 3000',
          action: () => this.checkFirewall(),
          icon: '🛡️',
        },
      ],
      technical: msg,
      severity: 'error',
      category: ErrorCategory.Network,
      helpUrl: 'https://docs.vector.dev/errors/network',
    }));

    // API key errors
    this.registerHandler('API_KEY|unauthorized|401|403', (msg) => ({
      message: 'Authentication failed - API key is missing or invalid',
      suggestion: 'Check your API key configuration in .env.local',
      quickFixes: [
        {
          label: 'Open .env.local',
          description: 'Edit your API key configuration',
          action: () => this.openEnvFile(),
          icon: '⚙️',
        },
        {
          label: 'Use free provider',
          description: 'Switch to a provider that doesn\'t require an API key',
          action: () => this.switchToFreeProvider(),
          icon: '🆓',
        },
        {
          label: 'Get API key',
          description: 'Instructions to obtain an API key',
          action: () => this.showAPIKeyInstructions(),
          icon: '🔑',
        },
      ],
      technical: msg,
      severity: 'error',
      category: ErrorCategory.Authentication,
      helpUrl: 'https://docs.vector.dev/errors/authentication',
    }));

    // File not found errors
    this.registerHandler('ENOENT|file not found|cannot find', (msg) => ({
      message: 'The requested file could not be found',
      suggestion: 'Verify the file path exists and is spelled correctly',
      quickFixes: [
        {
          label: 'Show file browser',
          description: 'Browse for the correct file',
          action: () => this.showFileBrowser(),
          icon: '📁',
        },
        {
          label: 'Create missing file',
          description: 'Create a new file at this location',
          action: () => this.createMissingFile(),
          icon: '➕',
        },
      ],
      technical: msg,
      severity: 'error',
      category: ErrorCategory.FileSystem,
      helpUrl: 'https://docs.vector.dev/errors/filesystem',
    }));

    // Permission errors
    this.registerHandler('EACCES|permission denied|access denied', (msg) => ({
      message: 'Permission denied - cannot access the requested resource',
      suggestion: 'Grant the necessary permissions in Roblox Studio',
      quickFixes: [
        {
          label: 'Enable HTTP requests',
          description: 'Enable HttpService in Studio settings',
          action: () => this.enableHttpService(),
          icon: '🌐',
        },
        {
          label: 'Enable script editing',
          description: 'Grant script modification permissions',
          action: () => this.enableScriptEditing(),
          icon: '✏️',
        },
      ],
      technical: msg,
      severity: 'error',
      category: ErrorCategory.Permission,
      helpUrl: 'https://docs.vector.dev/errors/permissions',
    }));

    // Rate limit errors
    this.registerHandler('rate limit|429|too many requests', (msg) => ({
      message: 'Rate limit exceeded - too many requests',
      suggestion: 'Wait a moment before trying again, or upgrade your plan',
      quickFixes: [
        {
          label: 'Retry after delay',
          description: 'Automatically retry after waiting',
          action: () => this.retryAfterDelay(5000),
          automatic: true,
          icon: '⏱️',
        },
        {
          label: 'Switch provider',
          description: 'Use a different LLM provider',
          action: () => this.switchProvider(),
          icon: '🔄',
        },
      ],
      technical: msg,
      severity: 'warning',
      category: ErrorCategory.API,
      helpUrl: 'https://docs.vector.dev/errors/rate-limit',
    }));

    // Syntax errors
    this.registerHandler('SyntaxError|syntax error|parse error', (msg) => ({
      message: 'Code syntax error detected',
      suggestion: 'Review the code for syntax mistakes',
      quickFixes: [
        {
          label: 'Show error location',
          description: 'Highlight the line with the syntax error',
          action: () => this.showErrorLocation(),
          icon: '📍',
        },
        {
          label: 'Auto-fix common issues',
          description: 'Attempt to automatically fix common syntax errors',
          action: () => this.autoFixSyntax(),
          icon: '🔧',
        },
      ],
      technical: msg,
      severity: 'error',
      category: ErrorCategory.Syntax,
      helpUrl: 'https://docs.vector.dev/errors/syntax',
    }));

    // Timeout errors
    this.registerHandler('timeout|ETIMEDOUT|timed out', (msg) => ({
      message: 'Request timed out',
      suggestion: 'The operation took too long. Try a simpler request or increase the timeout',
      quickFixes: [
        {
          label: 'Retry request',
          description: 'Try the request again',
          action: () => this.retryLastRequest(),
          icon: '🔄',
        },
        {
          label: 'Simplify request',
          description: 'Break down into smaller operations',
          action: () => this.simplifyRequest(),
          icon: '✂️',
        },
        {
          label: 'Increase timeout',
          description: 'Configure longer timeout in settings',
          action: () => this.increaseTimeout(),
          icon: '⏰',
        },
      ],
      technical: msg,
      severity: 'warning',
      category: ErrorCategory.Network,
      helpUrl: 'https://docs.vector.dev/errors/timeout',
    }));

    // Model errors
    this.registerHandler('model not found|invalid model|model error', (msg) => ({
      message: 'The selected AI model is not available',
      suggestion: 'Choose a different model or check your provider settings',
      quickFixes: [
        {
          label: 'Use default model',
          description: 'Switch to the default recommended model',
          action: () => this.useDefaultModel(),
          icon: '🎯',
        },
        {
          label: 'View available models',
          description: 'See list of supported models',
          action: () => this.showAvailableModels(),
          icon: '📋',
        },
      ],
      technical: msg,
      severity: 'error',
      category: ErrorCategory.Configuration,
      helpUrl: 'https://docs.vector.dev/errors/model',
    }));
  }

  /**
   * Create a generic error for unrecognized errors
   */
  private createGenericError(message: string, stack?: string): UserFriendlyError {
    return {
      message: 'An unexpected error occurred',
      suggestion: 'Try the operation again, or contact support if the problem persists',
      quickFixes: [
        {
          label: 'Retry',
          description: 'Try the operation again',
          action: () => this.retryLastRequest(),
          icon: '🔄',
        },
        {
          label: 'View logs',
          description: 'Check detailed logs for more information',
          action: () => this.viewLogs(),
          icon: '📜',
        },
        {
          label: 'Report issue',
          description: 'Report this error to the development team',
          action: () => this.reportIssue(message, stack),
          icon: '🐛',
        },
      ],
      technical: message,
      severity: 'error',
      category: ErrorCategory.Unknown,
      relatedErrors: this.findRelatedErrors(message),
    };
  }

  /**
   * Add error to history
   */
  private addToHistory(error: UserFriendlyError): void {
    this.errorHistory.unshift(error);
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.pop();
    }
  }

  /**
   * Find related errors from history
   */
  private findRelatedErrors(message: string): string[] {
    return this.errorHistory
      .filter(e => e.technical && this.calculateSimilarity(e.technical, message) > 0.5)
      .slice(0, 3)
      .map(e => e.message);
  }

  /**
   * Calculate similarity between two strings (simple Jaccard similarity)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const words1 = new Set(str1.toLowerCase().split(/\s+/));
    const words2 = new Set(str2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  // Quick fix action implementations (stubs)
  private async selectActiveScript(): Promise<void> {
    console.log('Quick fix: Select active script');
  }

  private async simplifyRequest(): Promise<void> {
    console.log('Quick fix: Simplify request');
  }

  private async showExamples(): Promise<void> {
    console.log('Quick fix: Show examples');
  }

  private async checkBackendStatus(): Promise<void> {
    console.log('Quick fix: Check backend status');
  }

  private async restartBackend(): Promise<void> {
    console.log('Quick fix: Restart backend');
  }

  private async checkFirewall(): Promise<void> {
    console.log('Quick fix: Check firewall');
  }

  private async openEnvFile(): Promise<void> {
    console.log('Quick fix: Open .env.local');
  }

  private async switchToFreeProvider(): Promise<void> {
    console.log('Quick fix: Switch to free provider');
  }

  private async showAPIKeyInstructions(): Promise<void> {
    console.log('Quick fix: Show API key instructions');
  }

  private async showFileBrowser(): Promise<void> {
    console.log('Quick fix: Show file browser');
  }

  private async createMissingFile(): Promise<void> {
    console.log('Quick fix: Create missing file');
  }

  private async enableHttpService(): Promise<void> {
    console.log('Quick fix: Enable HTTP service');
  }

  private async enableScriptEditing(): Promise<void> {
    console.log('Quick fix: Enable script editing');
  }

  private async retryAfterDelay(ms: number): Promise<void> {
    console.log(`Quick fix: Retry after ${ms}ms`);
  }

  private async switchProvider(): Promise<void> {
    console.log('Quick fix: Switch provider');
  }

  private async showErrorLocation(): Promise<void> {
    console.log('Quick fix: Show error location');
  }

  private async autoFixSyntax(): Promise<void> {
    console.log('Quick fix: Auto-fix syntax');
  }

  private async retryLastRequest(): Promise<void> {
    console.log('Quick fix: Retry last request');
  }

  private async increaseTimeout(): Promise<void> {
    console.log('Quick fix: Increase timeout');
  }

  private async useDefaultModel(): Promise<void> {
    console.log('Quick fix: Use default model');
  }

  private async showAvailableModels(): Promise<void> {
    console.log('Quick fix: Show available models');
  }

  private async viewLogs(): Promise<void> {
    console.log('Quick fix: View logs');
  }

  private async reportIssue(message: string, stack?: string): Promise<void> {
    console.log('Quick fix: Report issue', { message, stack });
  }
}

type ErrorTransformer = (message: string, stack?: string) => UserFriendlyError;

/**
 * Global error handler instance
 */
export const globalErrorHandler = new ErrorHandler();

/**
 * Convenience function to handle errors
 */
export function handleError(error: Error | string): UserFriendlyError {
  return globalErrorHandler.handle(error);
}
