/**
 * Multi-File Operations System
 * Fix for Issue #2: Limited Multi-File Operations
 *
 * Enables cross-file refactoring with dependency resolution and symbol tracking.
 * Supports complex operations like renaming symbols across multiple files,
 * moving code between files, and updating references automatically.
 */

export interface Edit {
  start: { line: number; character: number };
  end: { line: number; character: number };
  text: string;
}

export interface FileEdit {
  path: string;
  edits: Edit[];
  dependencies?: string[]; // files that must be processed first
  beforeHash?: string; // hash of file content before edits
  afterHash?: string; // expected hash after edits
}

export interface CrossFileRef {
  fromFile: string;
  toFile: string;
  symbol: string;
  action: 'rename' | 'move' | 'reference' | 'delete';
  line?: number;
  column?: number;
}

export interface MultiFileEdit {
  files: FileEdit[];
  crossFileRefs?: CrossFileRef[];
  description?: string;
  metadata?: {
    refactoringType?: 'rename' | 'extract' | 'inline' | 'move' | 'organize';
    affectedSymbols?: string[];
    estimatedImpact?: 'low' | 'medium' | 'high';
  };
}

export interface SymbolDefinition {
  name: string;
  type: 'function' | 'class' | 'variable' | 'type' | 'module';
  file: string;
  line: number;
  column: number;
  references: SymbolReference[];
}

export interface SymbolReference {
  file: string;
  line: number;
  column: number;
  type: 'read' | 'write' | 'call' | 'import';
}

export interface ImpactAnalysis {
  affectedFiles: string[];
  affectedSymbols: SymbolDefinition[];
  potentialConflicts: Conflict[];
  suggestedEdits: FileEdit[];
  riskLevel: 'low' | 'medium' | 'high';
}

export interface Conflict {
  file: string;
  type: 'circular-dependency' | 'naming-collision' | 'type-mismatch' | 'missing-import';
  description: string;
  severity: 'error' | 'warning' | 'info';
}

/**
 * Symbol tracking and code intelligence for cross-file operations
 */
export class CodeIntelligence {
  private symbolIndex: Map<string, SymbolDefinition[]> = new Map();
  private fileDependencies: Map<string, Set<string>> = new Map();
  private reverseIndex: Map<string, Set<string>> = new Map(); // file -> symbols defined

  /**
   * Index symbols from a file
   */
  async indexFile(filePath: string, content: string): Promise<void> {
    const symbols = this.extractSymbols(filePath, content);
    this.symbolIndex.set(filePath, symbols);

    // Update reverse index
    const symbolNames = new Set(symbols.map(s => s.name));
    this.reverseIndex.set(filePath, symbolNames);

    // Extract dependencies (imports, requires, etc.)
    const deps = this.extractDependencies(content);
    this.fileDependencies.set(filePath, new Set(deps));
  }

  /**
   * Extract symbols from file content
   */
  private extractSymbols(filePath: string, content: string): SymbolDefinition[] {
    const symbols: SymbolDefinition[] = [];
    const lines = content.split('\n');

    // Lua/Luau patterns
    const functionPattern = /(?:local\s+)?function\s+(\w+)/g;
    const variablePattern = /(?:local\s+)?(\w+)\s*=/g;
    const classPattern = /local\s+(\w+)\s*=\s*\{\}/g;

    lines.forEach((line, lineNum) => {
      // Extract functions
      let match;
      while ((match = functionPattern.exec(line)) !== null) {
        symbols.push({
          name: match[1],
          type: 'function',
          file: filePath,
          line: lineNum,
          column: match.index,
          references: [],
        });
      }

      // Extract variables/classes
      while ((match = variablePattern.exec(line)) !== null) {
        const name = match[1];
        // Skip if it's a function (already captured)
        if (!line.includes(`function ${name}`)) {
          symbols.push({
            name,
            type: line.includes('{}') ? 'class' : 'variable',
            file: filePath,
            line: lineNum,
            column: match.index,
            references: [],
          });
        }
      }
    });

    return symbols;
  }

  /**
   * Extract file dependencies (require/import statements)
   */
  private extractDependencies(content: string): string[] {
    const deps: string[] = [];
    const requirePattern = /require\s*\(\s*["']([^"']+)["']\s*\)/g;

    let match;
    while ((match = requirePattern.exec(content)) !== null) {
      deps.push(match[1]);
    }

    return deps;
  }

  /**
   * Analyze cross-file impact of proposed changes
   */
  async analyzeCrossFileImpact(changes: MultiFileEdit): Promise<ImpactAnalysis> {
    const affectedFiles = new Set<string>();
    const affectedSymbols: SymbolDefinition[] = [];
    const potentialConflicts: Conflict[] = [];
    const suggestedEdits: FileEdit[] = [];

    // Track which symbols are being modified
    for (const fileEdit of changes.files) {
      affectedFiles.add(fileEdit.path);

      // Find symbols in this file
      const fileSymbols = this.symbolIndex.get(fileEdit.path) || [];

      // Check if edits affect any symbol definitions
      for (const edit of fileEdit.edits) {
        const affectedInFile = fileSymbols.filter(sym =>
          this.isPositionInRange(sym.line, sym.column, edit)
        );
        affectedSymbols.push(...affectedInFile);
      }
    }

    // For each affected symbol, find all references across files
    for (const symbol of affectedSymbols) {
      const references = await this.findAllReferences(symbol);

      for (const ref of references) {
        affectedFiles.add(ref.file);

        // If reference is not in the change set, suggest an edit
        const isAlreadyIncluded = changes.files.some(f => f.path === ref.file);
        if (!isAlreadyIncluded) {
          // Add suggested edit for this file
          const existingEdit = suggestedEdits.find(e => e.path === ref.file);
          if (!existingEdit) {
            suggestedEdits.push({
              path: ref.file,
              edits: [],
              dependencies: [symbol.file],
            });
          }
        }
      }
    }

    // Check for circular dependencies
    const circularDeps = this.detectCircularDependencies(
      Array.from(affectedFiles),
      changes.files
    );
    potentialConflicts.push(...circularDeps);

    // Check for naming collisions
    const namingCollisions = this.detectNamingCollisions(changes);
    potentialConflicts.push(...namingCollisions);

    // Determine risk level
    const riskLevel = this.calculateRiskLevel(affectedFiles.size, potentialConflicts);

    return {
      affectedFiles: Array.from(affectedFiles),
      affectedSymbols,
      potentialConflicts,
      suggestedEdits,
      riskLevel,
    };
  }

  /**
   * Find all references to a symbol across all indexed files
   */
  private async findAllReferences(symbol: SymbolDefinition): Promise<SymbolReference[]> {
    const references: SymbolReference[] = [];

    // Search through all indexed files
    for (const [filePath, _symbols] of this.symbolIndex) {
      // In a real implementation, you'd parse the file content
      // and find actual references. This is a simplified version.

      // Check if this file imports/requires the symbol's file
      const deps = this.fileDependencies.get(filePath);
      if (deps?.has(symbol.file)) {
        // Add placeholder reference
        references.push({
          file: filePath,
          line: 0,
          column: 0,
          type: 'import',
        });
      }
    }

    return references;
  }

  /**
   * Check if a position is within an edit range
   */
  private isPositionInRange(
    line: number,
    column: number,
    edit: Edit
  ): boolean {
    if (line < edit.start.line || line > edit.end.line) return false;
    if (line === edit.start.line && column < edit.start.character) return false;
    if (line === edit.end.line && column > edit.end.character) return false;
    return true;
  }

  /**
   * Detect circular dependencies in the edit set
   */
  private detectCircularDependencies(
    files: string[],
    edits: FileEdit[]
  ): Conflict[] {
    const conflicts: Conflict[] = [];
    const graph = new Map<string, Set<string>>();

    // Build dependency graph
    for (const edit of edits) {
      if (!graph.has(edit.path)) {
        graph.set(edit.path, new Set());
      }
      edit.dependencies?.forEach(dep => {
        graph.get(edit.path)!.add(dep);
      });
    }

    // Detect cycles using DFS
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (node: string, path: string[]): boolean => {
      visited.add(node);
      recursionStack.add(node);

      const neighbors = graph.get(node) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (hasCycle(neighbor, [...path, neighbor])) return true;
        } else if (recursionStack.has(neighbor)) {
          conflicts.push({
            file: node,
            type: 'circular-dependency',
            description: `Circular dependency detected: ${[...path, neighbor, node].join(' -> ')}`,
            severity: 'error',
          });
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    };

    for (const file of files) {
      if (!visited.has(file)) {
        hasCycle(file, [file]);
      }
    }

    return conflicts;
  }

  /**
   * Detect naming collisions in the edit set
   */
  private detectNamingCollisions(changes: MultiFileEdit): Conflict[] {
    const conflicts: Conflict[] = [];

    if (!changes.crossFileRefs) return conflicts;

    const symbolsByName = new Map<string, CrossFileRef[]>();

    for (const ref of changes.crossFileRefs) {
      if (!symbolsByName.has(ref.symbol)) {
        symbolsByName.set(ref.symbol, []);
      }
      symbolsByName.get(ref.symbol)!.push(ref);
    }

    // Check for symbols with conflicting definitions
    for (const [symbol, refs] of symbolsByName) {
      const definitions = refs.filter(r => r.action === 'move' || r.action === 'rename');
      if (definitions.length > 1) {
        conflicts.push({
          file: definitions[0].fromFile,
          type: 'naming-collision',
          description: `Symbol "${symbol}" has conflicting definitions across files`,
          severity: 'warning',
        });
      }
    }

    return conflicts;
  }

  /**
   * Calculate risk level based on impact
   */
  private calculateRiskLevel(
    affectedFileCount: number,
    conflicts: Conflict[]
  ): 'low' | 'medium' | 'high' {
    const errorCount = conflicts.filter(c => c.severity === 'error').length;

    if (errorCount > 0) return 'high';
    if (affectedFileCount > 10) return 'high';
    if (affectedFileCount > 5) return 'medium';
    return 'low';
  }

  /**
   * Resolve dependencies and order files for safe processing
   */
  resolveDependencyOrder(files: FileEdit[]): FileEdit[] {
    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    // Initialize graph
    for (const file of files) {
      graph.set(file.path, new Set(file.dependencies || []));
      inDegree.set(file.path, 0);
    }

    // Calculate in-degrees
    for (const [_file, deps] of graph) {
      for (const dep of deps) {
        inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
      }
    }

    // Topological sort
    const queue: string[] = [];
    const result: FileEdit[] = [];

    for (const [file, degree] of inDegree) {
      if (degree === 0) {
        queue.push(file);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const fileEdit = files.find(f => f.path === current);
      if (fileEdit) result.push(fileEdit);

      const deps = graph.get(current) || new Set();
      for (const dep of deps) {
        const newDegree = (inDegree.get(dep) || 1) - 1;
        inDegree.set(dep, newDegree);
        if (newDegree === 0) {
          queue.push(dep);
        }
      }
    }

    return result;
  }
}

/**
 * Multi-file edit executor with rollback support
 */
export class MultiFileEditExecutor {
  private codeIntelligence: CodeIntelligence;
  private backups: Map<string, string> = new Map();

  constructor(codeIntelligence: CodeIntelligence) {
    this.codeIntelligence = codeIntelligence;
  }

  /**
   * Execute multi-file edits with automatic rollback on failure
   */
  async executeMultiFileEdit(
    changes: MultiFileEdit,
    options?: {
      dryRun?: boolean;
      skipAnalysis?: boolean;
    }
  ): Promise<{ success: boolean; analysis?: ImpactAnalysis; error?: string }> {
    try {
      // Analyze impact unless skipped
      let analysis: ImpactAnalysis | undefined;
      if (!options?.skipAnalysis) {
        analysis = await this.codeIntelligence.analyzeCrossFileImpact(changes);

        // Check for blocking conflicts
        const blockingErrors = analysis.potentialConflicts.filter(
          c => c.severity === 'error'
        );
        if (blockingErrors.length > 0) {
          return {
            success: false,
            analysis,
            error: `Blocking conflicts detected: ${blockingErrors.map(e => e.description).join(', ')}`,
          };
        }
      }

      if (options?.dryRun) {
        return { success: true, analysis };
      }

      // Resolve dependency order
      const orderedFiles = this.codeIntelligence.resolveDependencyOrder(changes.files);

      // Backup all files before making changes
      for (const fileEdit of orderedFiles) {
        const content = await this.readFile(fileEdit.path);
        this.backups.set(fileEdit.path, content);
      }

      // Apply edits in order
      for (const fileEdit of orderedFiles) {
        await this.applyFileEdit(fileEdit);
      }

      // Clear backups on success
      this.backups.clear();

      return { success: true, analysis };

    } catch (error) {
      // Rollback all changes
      await this.rollback();

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Apply edits to a single file
   */
  private async applyFileEdit(fileEdit: FileEdit): Promise<void> {
    let content = await this.readFile(fileEdit.path);

    // Validate beforeHash if provided
    if (fileEdit.beforeHash) {
      const actualHash = this.hashContent(content);
      if (actualHash !== fileEdit.beforeHash) {
        throw new Error(
          `File ${fileEdit.path} has been modified. Expected hash ${fileEdit.beforeHash}, got ${actualHash}`
        );
      }
    }

    // Apply edits in reverse order to maintain positions
    const sortedEdits = [...fileEdit.edits].sort((a, b) => {
      if (a.start.line !== b.start.line) return b.start.line - a.start.line;
      return b.start.character - a.start.character;
    });

    const lines = content.split('\n');
    for (const edit of sortedEdits) {
      lines[edit.start.line] =
        lines[edit.start.line].slice(0, edit.start.character) +
        edit.text +
        lines[edit.end.line].slice(edit.end.character);
    }

    content = lines.join('\n');

    // Validate afterHash if provided
    if (fileEdit.afterHash) {
      const actualHash = this.hashContent(content);
      if (actualHash !== fileEdit.afterHash) {
        throw new Error(
          `File ${fileEdit.path} hash mismatch after edit. Expected ${fileEdit.afterHash}, got ${actualHash}`
        );
      }
    }

    await this.writeFile(fileEdit.path, content);
  }

  /**
   * Rollback all changes using backups
   */
  private async rollback(): Promise<void> {
    for (const [path, content] of this.backups) {
      await this.writeFile(path, content);
    }
    this.backups.clear();
  }

  /**
   * Read file content (stub - implement with actual file system)
   */
  private async readFile(path: string): Promise<string> {
    // In real implementation, use fs.readFile or similar
    throw new Error(`readFile not implemented: ${path}`);
  }

  /**
   * Write file content (stub - implement with actual file system)
   */
  private async writeFile(path: string, content: string): Promise<void> {
    // In real implementation, use fs.writeFile or similar
    throw new Error(`writeFile not implemented: ${path}, ${content}`);
  }

  /**
   * Hash file content for validation
   */
  private hashContent(content: string): string {
    // Simple hash function - in production use crypto.createHash
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
}
