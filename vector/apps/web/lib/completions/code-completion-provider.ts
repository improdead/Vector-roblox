/**
 * Inline Code Suggestions System
 * Fix for Issue #3: No Inline Code Suggestions
 *
 * Provides autocomplete and inline suggestions alongside the proposal system.
 * Uses a hybrid approach: simple edits get inline suggestions, complex changes
 * fall back to the full proposal workflow.
 */

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Context {
  currentFile: string;
  currentPosition: Position;
  prefix: string;
  suffix: string;
  selectedText?: string;
  openFiles: string[];
  recentSymbols: string[];
  projectContext?: {
    framework?: string;
    language: string;
    dependencies: string[];
  };
}

export interface Completion {
  label: string;
  kind: CompletionKind;
  detail?: string;
  documentation?: string;
  insertText: string;
  range?: Range;
  sortText?: string;
  filterText?: string;
  preselect?: boolean;
  score?: number;
}

export enum CompletionKind {
  Function = 'function',
  Variable = 'variable',
  Class = 'class',
  Method = 'method',
  Property = 'property',
  Keyword = 'keyword',
  Snippet = 'snippet',
  Module = 'module',
  Text = 'text',
}

export interface Suggestion {
  type: 'inline' | 'proposal';
  content: string;
  range?: Range;
  confidence: number; // 0-1
  reasoning?: string;
}

export interface CodeCompletionProvider {
  /**
   * Get inline completions at a specific position
   */
  getInlineCompletions(position: Position, context: Context): Promise<Completion[]>;

  /**
   * Get contextual suggestions based on prefix and context
   */
  getContextualSuggestions(prefix: string, context: Context): Promise<Suggestion[]>;

  /**
   * Predict the next line of code
   */
  predictNextLine(context: Context): Promise<string | null>;
}

/**
 * Hybrid editor that combines inline suggestions with proposals
 */
export class HybridEditor {
  private completionProvider: CodeCompletionProvider;
  private orchestrator: any; // LLM orchestrator for complex edits

  constructor(completionProvider: CodeCompletionProvider, orchestrator: any) {
    this.completionProvider = completionProvider;
    this.orchestrator = orchestrator;
  }

  /**
   * Get suggestions based on input complexity
   * Simple edits return inline suggestions, complex changes return proposals
   */
  async getSuggestions(input: string, context: Context): Promise<Suggestion[]> {
    const complexity = this.analyzeComplexity(input, context);

    if (complexity === 'simple') {
      // Use inline completion provider for simple edits
      const completions = await this.completionProvider.getInlineCompletions(
        context.currentPosition,
        context
      );

      return completions.map(c => ({
        type: 'inline' as const,
        content: c.insertText,
        range: c.range,
        confidence: c.score || 0.8,
        reasoning: c.detail,
      }));
    } else {
      // Fall back to orchestrator for complex changes
      const proposals = await this.orchestrator.runLLM(input);

      return [
        {
          type: 'proposal' as const,
          content: proposals,
          confidence: 0.9,
          reasoning: 'Complex change requiring review',
        },
      ];
    }
  }

  /**
   * Analyze input complexity to determine handling strategy
   */
  private analyzeComplexity(input: string, context: Context): 'simple' | 'complex' {
    // Simple edit indicators
    const simpleIndicators = [
      input.length < 50, // Short input
      !input.includes('\n'), // Single line
      /^(add|insert|complete|finish)/.test(input.toLowerCase()), // Simple verbs
      context.selectedText && context.selectedText.length < 100, // Small selection
    ];

    // Complex edit indicators
    const complexIndicators = [
      input.includes('refactor'),
      input.includes('rename'),
      input.includes('extract'),
      input.includes('move'),
      input.includes('across files'),
      input.includes('multiple'),
      context.selectedText && context.selectedText.length > 500,
    ];

    const simpleScore = simpleIndicators.filter(Boolean).length;
    const complexScore = complexIndicators.filter(Boolean).length;

    return complexScore > simpleScore ? 'complex' : 'simple';
  }
}

/**
 * LLM-powered code completion provider
 */
export class LLMCodeCompletionProvider implements CodeCompletionProvider {
  private cache: Map<string, Completion[]> = new Map();
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-3.5-turbo') {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Get inline completions using LLM
   */
  async getInlineCompletions(
    position: Position,
    context: Context
  ): Promise<Completion[]> {
    // Check cache first
    const cacheKey = this.getCacheKey(position, context);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Build prompt for LLM
    const prompt = this.buildCompletionPrompt(context);

    try {
      // Call LLM for completions
      const completions = await this.fetchCompletions(prompt, context);

      // Cache results
      this.cache.set(cacheKey, completions);

      return completions;
    } catch (error) {
      console.error('Completion error:', error);
      return [];
    }
  }

  /**
   * Get contextual suggestions
   */
  async getContextualSuggestions(
    prefix: string,
    context: Context
  ): Promise<Suggestion[]> {
    const prompt = `Given the context:\n${context.prefix}\n\nSuggest the next code based on: ${prefix}`;

    try {
      const response = await this.callLLM(prompt, {
        temperature: 0.3,
        maxTokens: 100,
      });

      return [
        {
          type: 'inline',
          content: response.trim(),
          confidence: 0.85,
          reasoning: 'LLM-based contextual suggestion',
        },
      ];
    } catch (error) {
      console.error('Suggestion error:', error);
      return [];
    }
  }

  /**
   * Predict the next line of code
   */
  async predictNextLine(context: Context): Promise<string | null> {
    const prompt = this.buildNextLinePrompt(context);

    try {
      const response = await this.callLLM(prompt, {
        temperature: 0.2,
        maxTokens: 80,
        stop: ['\n\n'],
      });

      return response.trim();
    } catch (error) {
      console.error('Prediction error:', error);
      return null;
    }
  }

  /**
   * Build completion prompt from context
   */
  private buildCompletionPrompt(context: Context): string {
    return `Complete the following ${context.projectContext?.language || 'Lua'} code:

File: ${context.currentFile}
Context:
${context.prefix}
<cursor>
${context.suffix}

Provide up to 5 relevant completions. Consider:
- Project framework: ${context.projectContext?.framework || 'Roblox'}
- Recent symbols: ${context.recentSymbols.join(', ')}
- Language: ${context.projectContext?.language || 'Lua'}

Return completions in JSON format:
{
  "completions": [
    {"label": "function_name", "kind": "function", "insertText": "function_name()"}
  ]
}`;
  }

  /**
   * Build next line prediction prompt
   */
  private buildNextLinePrompt(context: Context): string {
    return `Predict the next line of ${context.projectContext?.language || 'Lua'} code:

${context.prefix}
<next line>`;
  }

  /**
   * Fetch completions from LLM
   */
  private async fetchCompletions(
    prompt: string,
    context: Context
  ): Promise<Completion[]> {
    const response = await this.callLLM(prompt, {
      temperature: 0.4,
      maxTokens: 500,
    });

    try {
      // Try to parse JSON response
      const parsed = JSON.parse(response);
      if (parsed.completions && Array.isArray(parsed.completions)) {
        return parsed.completions.map((c: any, index: number) => ({
          label: c.label,
          kind: this.parseCompletionKind(c.kind),
          detail: c.detail,
          documentation: c.documentation,
          insertText: c.insertText,
          score: 1.0 - index * 0.1, // Decrease score for later items
        }));
      }
    } catch (error) {
      // Fallback: treat response as single completion
      return [
        {
          label: 'AI Suggestion',
          kind: CompletionKind.Text,
          insertText: response.trim(),
          score: 0.7,
        },
      ];
    }

    return [];
  }

  /**
   * Call LLM API
   */
  private async callLLM(
    prompt: string,
    options: { temperature: number; maxTokens: number; stop?: string[] }
  ): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stop: options.stop,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * Generate cache key for memoization
   */
  private getCacheKey(position: Position, context: Context): string {
    return `${context.currentFile}:${position.line}:${position.character}:${context.prefix.slice(-50)}`;
  }

  /**
   * Parse completion kind from string
   */
  private parseCompletionKind(kind: string): CompletionKind {
    const allKinds = Object.values(CompletionKind) as string[];
    if (allKinds.includes(kind)) {
      return kind as CompletionKind;
    }
    return CompletionKind.Text;
  }
}

/**
 * Pattern-based completion provider (fallback when LLM is unavailable)
 */
export class PatternBasedCompletionProvider implements CodeCompletionProvider {
  private patterns: Map<RegExp, CompletionTemplate[]> = new Map();

  constructor() {
    this.initializePatterns();
  }

  /**
   * Initialize common Lua/Luau patterns
   */
  private initializePatterns(): void {
    // Function patterns
    this.patterns.set(/function\s+(\w+)$/, [
      {
        label: 'function with parameters',
        insertText: '${1:functionName}(${2:params})\n\t${3:-- body}\nend',
        kind: CompletionKind.Snippet,
      },
    ]);

    // If patterns
    this.patterns.set(/if\s+.*\s+then$/, [
      {
        label: 'if-else',
        insertText: '\n\t${1:-- then body}\nelse\n\t${2:-- else body}\nend',
        kind: CompletionKind.Snippet,
      },
    ]);

    // For loop patterns
    this.patterns.set(/for\s+.*\s+do$/, [
      {
        label: 'for loop body',
        insertText: '\n\t${1:-- loop body}\nend',
        kind: CompletionKind.Snippet,
      },
    ]);

    // Local variable patterns
    this.patterns.set(/local\s+(\w+)\s*=$/, [
      {
        label: 'local variable',
        insertText: ' ${1:value}',
        kind: CompletionKind.Variable,
      },
    ]);

    // Roblox-specific patterns
    this.patterns.set(/Instance\.new\("/, [
      {
        label: 'Part',
        insertText: 'Part")',
        kind: CompletionKind.Class,
      },
      {
        label: 'Model',
        insertText: 'Model")',
        kind: CompletionKind.Class,
      },
      {
        label: 'Script',
        insertText: 'Script")',
        kind: CompletionKind.Class,
      },
    ]);
  }

  async getInlineCompletions(
    position: Position,
    context: Context
  ): Promise<Completion[]> {
    const completions: Completion[] = [];

    // Match against patterns
    for (const [pattern, templates] of this.patterns) {
      if (pattern.test(context.prefix)) {
        completions.push(
          ...templates.map(t => ({
            label: t.label,
            kind: t.kind,
            insertText: t.insertText,
            detail: 'Pattern-based suggestion',
            score: 0.6,
          }))
        );
      }
    }

    return completions;
  }

  async getContextualSuggestions(
    prefix: string,
    context: Context
  ): Promise<Suggestion[]> {
    const completions = await this.getInlineCompletions(context.currentPosition, context);

    return completions.map(c => ({
      type: 'inline' as const,
      content: c.insertText,
      confidence: c.score || 0.5,
      reasoning: 'Pattern-based suggestion',
    }));
  }

  async predictNextLine(context: Context): Promise<string | null> {
    // Simple heuristic: if line ends with 'then' or 'do', suggest indent
    if (context.prefix.trimEnd().endsWith('then') || context.prefix.trimEnd().endsWith('do')) {
      return '\t';
    }

    return null;
  }
}

interface CompletionTemplate {
  label: string;
  insertText: string;
  kind: CompletionKind;
  detail?: string;
}
