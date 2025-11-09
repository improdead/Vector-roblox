/**
 * Intelligent Context Caching System
 * Fix for Issue #5: Missing Context Caching Optimization
 *
 * Implements proactive context preloading and intelligent caching
 * to reduce latency and provide faster responses.
 */

export interface ContextSnapshot {
  /** Unique key for this context */
  key: string;

  /** The actual context data */
  context: Context;

  /** When this snapshot was created */
  timestamp: number;

  /** Time-to-live in milliseconds */
  ttl: number;

  /** Relevance score (0-1) */
  relevance: number;

  /** File hashes for invalidation detection */
  fileHashes: Map<string, string>;

  /** Size in bytes */
  size: number;

  /** Access count for LRU eviction */
  accessCount: number;

  /** Last access timestamp */
  lastAccess: number;
}

export interface Context {
  projectId: string;
  activeFile?: string;
  activeScript?: string;
  selection?: {
    file: string;
    start: { line: number; character: number };
    end: { line: number; character: number };
    text: string;
  };
  openFiles: string[];
  recentSymbols: string[];
  sceneHierarchy?: any;
  dependencies?: string[];
  metadata?: Record<string, any>;
}

export interface ContextRequest {
  key: string;
  projectId: string;
  priority?: 'low' | 'normal' | 'high';
  maxAge?: number; // Max age in ms for cached context
  forceRefresh?: boolean;
}

export interface PredictionResult {
  likelyFiles: string[];
  likelySymbols: string[];
  likelyOperations: string[];
  confidence: number;
}

/**
 * Proactive context manager with intelligent caching and preloading
 */
export class ContextManager {
  private contextCache: Map<string, ContextSnapshot> = new Map();
  private relevanceScores: Map<string, number> = new Map();
  private predictionHistory: Map<string, PredictionResult[]> = new Map();

  // Cache configuration
  private maxCacheSize: number = 100 * 1024 * 1024; // 100MB
  private currentCacheSize: number = 0;
  private defaultTTL: number = 5 * 60 * 1000; // 5 minutes

  // Preloading configuration
  private preloadEnabled: boolean = true;
  private preloadQueue: Set<string> = new Set();
  private isPreloading: boolean = false;

  // Cache statistics
  private cacheHits: number = 0;
  private cacheMisses: number = 0;

  /**
   * Get context with intelligent caching
   */
  async getContext(request: ContextRequest): Promise<Context> {
    // Check cache first
    if (!request.forceRefresh) {
      const cached = this.contextCache.get(request.key);
      if (cached && this.isStillRelevant(cached, request.maxAge)) {
        // Cache hit
        this.cacheHits++;
        cached.accessCount++;
        cached.lastAccess = Date.now();
        return cached.context;
      }
    }

    // Cache miss - gather fresh context
    this.cacheMisses++;
    const context = await this.gatherFreshContext(request);

    // Cache the result
    await this.cacheContext(request.key, context, request.projectId);

    // Trigger preloading if enabled
    if (this.preloadEnabled) {
      this.preloadRelevantContext(request.projectId);
    }

    return context;
  }

  /**
   * Preload relevant context proactively
   */
  async preloadRelevantContext(projectId: string): Promise<void> {
    if (this.isPreloading) return;

    this.isPreloading = true;

    try {
      // Predict likely next operations
      const predictions = await this.predictNeededContext(projectId);

      // Preload predicted contexts
      for (const file of predictions.likelyFiles) {
        const key = this.generateContextKey(projectId, file);
        if (!this.contextCache.has(key) && !this.preloadQueue.has(key)) {
          this.preloadQueue.add(key);

          // Preload in background
          this.preloadContext(projectId, file, predictions.confidence)
            .catch(err => console.warn('Preload failed:', err))
            .finally(() => this.preloadQueue.delete(key));
        }
      }

      // Store prediction for learning
      if (!this.predictionHistory.has(projectId)) {
        this.predictionHistory.set(projectId, []);
      }
      this.predictionHistory.get(projectId)!.push(predictions);

    } finally {
      this.isPreloading = false;
    }
  }

  /**
   * Predict what context will be needed next
   */
  private async predictNeededContext(projectId: string): Promise<PredictionResult> {
    const predictions: PredictionResult = {
      likelyFiles: [],
      likelySymbols: [],
      likelyOperations: [],
      confidence: 0.5,
    };

    // Get current context
    const currentContext = await this.getCurrentContext(projectId);

    // Predict based on current file
    if (currentContext.activeFile) {
      predictions.likelyFiles.push(
        ...await this.predictRelatedFiles(currentContext.activeFile)
      );
    }

    // Predict based on recent activity
    const recentFiles = this.getRecentlyAccessedFiles(projectId);
    predictions.likelyFiles.push(...recentFiles.slice(0, 5));

    // Predict based on dependencies
    if (currentContext.dependencies) {
      predictions.likelyFiles.push(...currentContext.dependencies.slice(0, 3));
    }

    // Predict symbols based on common patterns
    predictions.likelySymbols = await this.predictRelevantSymbols(currentContext);

    // Predict likely operations
    predictions.likelyOperations = this.predictOperations(currentContext);

    // Calculate confidence based on historical accuracy
    predictions.confidence = this.calculatePredictionConfidence(projectId);

    return predictions;
  }

  /**
   * Predict files related to the current file
   */
  private async predictRelatedFiles(currentFile: string): Promise<string[]> {
    const related: string[] = [];

    // Same directory
    const dir = currentFile.substring(0, currentFile.lastIndexOf('/'));
    // Would scan directory for related files

    // Test files
    if (!currentFile.includes('.test.') && !currentFile.includes('.spec.')) {
      const testFile = currentFile.replace(/\.(ts|js|lua)$/, '.test.$1');
      related.push(testFile);
    }

    // Implementation files (if this is a test)
    if (currentFile.includes('.test.') || currentFile.includes('.spec.')) {
      const implFile = currentFile.replace(/\.(test|spec)\./, '.');
      related.push(implFile);
    }

    return related;
  }

  /**
   * Predict relevant symbols based on context
   */
  private async predictRelevantSymbols(context: Context): Promise<string[]> {
    const symbols: string[] = [];

    // Recent symbols are likely to be used again
    symbols.push(...context.recentSymbols.slice(0, 10));

    // Common patterns in the project
    // Would analyze project to find frequently used symbols

    return symbols;
  }

  /**
   * Predict likely operations based on context
   */
  private predictOperations(context: Context): string[] {
    const operations: string[] = [];

    // If a file is selected, predict edit operations
    if (context.activeFile) {
      operations.push('edit', 'read', 'navigate');
    }

    // If there's a selection, predict refactoring operations
    if (context.selection) {
      operations.push('extract', 'rename', 'inline');
    }

    return operations;
  }

  /**
   * Calculate prediction confidence based on historical accuracy
   */
  private calculatePredictionConfidence(projectId: string): number {
    const history = this.predictionHistory.get(projectId);
    if (!history || history.length === 0) return 0.5;

    // Simple average of recent prediction confidences
    const recent = history.slice(-10);
    const avgConfidence = recent.reduce((sum, p) => sum + p.confidence, 0) / recent.length;

    return avgConfidence;
  }

  /**
   * Get recently accessed files for a project
   */
  private getRecentlyAccessedFiles(projectId: string): string[] {
    const files: string[] = [];

    // Sort cache entries by last access time
    const entries = Array.from(this.contextCache.values())
      .filter(snapshot => snapshot.context.projectId === projectId)
      .sort((a, b) => b.lastAccess - a.lastAccess);

    for (const entry of entries) {
      if (entry.context.activeFile) {
        files.push(entry.context.activeFile);
      }
    }

    return [...new Set(files)];
  }

  /**
   * Preload context for a specific file
   */
  private async preloadContext(
    projectId: string,
    file: string,
    confidence: number
  ): Promise<void> {
    const context = await this.gatherContextForFile(projectId, file);
    const key = this.generateContextKey(projectId, file);

    const snapshot: ContextSnapshot = {
      key,
      context,
      timestamp: Date.now(),
      ttl: this.defaultTTL,
      relevance: confidence,
      fileHashes: await this.computeFileHashes([file]),
      size: this.estimateSize(context),
      accessCount: 0,
      lastAccess: Date.now(),
    };

    // Only cache if we have space or can evict
    if (this.canCache(snapshot.size)) {
      this.contextCache.set(key, snapshot);
      this.currentCacheSize += snapshot.size;
    }
  }

  /**
   * Cache context with metadata
   */
  private async cacheContext(
    key: string,
    context: Context,
    projectId: string
  ): Promise<void> {
    const files = this.extractFiles(context);
    const fileHashes = await this.computeFileHashes(files);
    const size = this.estimateSize(context);

    const snapshot: ContextSnapshot = {
      key,
      context,
      timestamp: Date.now(),
      ttl: this.defaultTTL,
      relevance: this.relevanceScores.get(key) || 1.0,
      fileHashes,
      size,
      accessCount: 1,
      lastAccess: Date.now(),
    };

    // Remove old snapshot if refreshing
    const existing = this.contextCache.get(key);
    if (existing) {
      this.contextCache.delete(key);
      this.currentCacheSize -= existing.size;
    }

    // Ensure we have space
    if (!this.canCache(size)) {
      await this.evictLRU(size);
    }

    this.contextCache.set(key, snapshot);
    this.currentCacheSize += size;
  }

  /**
   * Check if a cached context is still relevant
   */
  private isStillRelevant(snapshot: ContextSnapshot, maxAge?: number): boolean {
    const now = Date.now();
    const age = now - snapshot.timestamp;

    // Check TTL
    const ttl = maxAge ?? snapshot.ttl;
    if (age > ttl) return false;

    // Check if files have been modified
    // In a real implementation, would check actual file modification times
    // For now, assume files haven't changed if within TTL

    return true;
  }

  /**
   * Gather fresh context (stub implementation)
   */
  private async gatherFreshContext(request: ContextRequest): Promise<Context> {
    // In real implementation, gather context from various sources:
    // - Active file/script
    // - Selection
    // - Open files
    // - Scene hierarchy
    // - Recent symbols
    // etc.

    return {
      projectId: request.projectId,
      openFiles: [],
      recentSymbols: [],
    };
  }

  /**
   * Get current context for a project
   */
  private async getCurrentContext(projectId: string): Promise<Context> {
    // Find most recent context for this project
    const entries = Array.from(this.contextCache.values())
      .filter(s => s.context.projectId === projectId)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (entries.length > 0) {
      return entries[0].context;
    }

    // Gather fresh context if none cached
    return this.gatherFreshContext({ key: 'current', projectId });
  }

  /**
   * Gather context for a specific file
   */
  private async gatherContextForFile(projectId: string, file: string): Promise<Context> {
    // In real implementation, read file content and extract context
    return {
      projectId,
      activeFile: file,
      openFiles: [file],
      recentSymbols: [],
    };
  }

  /**
   * Extract file paths from context
   */
  private extractFiles(context: Context): string[] {
    const files: string[] = [];

    if (context.activeFile) files.push(context.activeFile);
    if (context.activeScript) files.push(context.activeScript);
    if (context.selection?.file) files.push(context.selection.file);
    files.push(...context.openFiles);

    return [...new Set(files)];
  }

  /**
   * Compute file hashes for invalidation detection
   */
  private async computeFileHashes(files: string[]): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();

    // In real implementation, compute actual file hashes
    for (const file of files) {
      // Stub: use file path as hash
      hashes.set(file, `hash-${file}`);
    }

    return hashes;
  }

  /**
   * Estimate size of context in bytes
   */
  private estimateSize(context: Context): number {
    // Rough estimation based on JSON string length
    return JSON.stringify(context).length;
  }

  /**
   * Check if we can cache an item of given size
   */
  private canCache(size: number): boolean {
    return this.currentCacheSize + size <= this.maxCacheSize;
  }

  /**
   * Evict least recently used items to make space
   */
  private async evictLRU(requiredSpace: number): Promise<void> {
    // Sort by last access time (oldest first)
    const entries = Array.from(this.contextCache.entries())
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    let freedSpace = 0;

    for (const [key, snapshot] of entries) {
      if (freedSpace >= requiredSpace) break;

      this.contextCache.delete(key);
      this.currentCacheSize -= snapshot.size;
      freedSpace += snapshot.size;
    }
  }

  /**
   * Generate a unique key for context caching
   */
  private generateContextKey(projectId: string, file: string): string {
    return `${projectId}:${file}`;
  }

  /**
   * Clear all cached context
   */
  clearCache(): void {
    this.contextCache.clear();
    this.currentCacheSize = 0;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    entries: number;
    hitRate: number;
  } {
    const totalAccesses = this.cacheHits + this.cacheMisses;
    const hitRate = totalAccesses > 0 ? this.cacheHits / totalAccesses : 0;

    return {
      size: this.currentCacheSize,
      maxSize: this.maxCacheSize,
      entries: this.contextCache.size,
      hitRate,
    };
  }

  /**
   * Enable or disable preloading
   */
  setPreloadEnabled(enabled: boolean): void {
    this.preloadEnabled = enabled;
  }

  /**
   * Invalidate cache for specific files
   */
  invalidateFiles(files: string[]): void {
    const fileSet = new Set(files);

    for (const [key, snapshot] of this.contextCache) {
      // Check if any of the snapshot's files match
      const snapshotFiles = this.extractFiles(snapshot.context);
      const hasInvalidFile = snapshotFiles.some(f => fileSet.has(f));

      if (hasInvalidFile) {
        this.contextCache.delete(key);
        this.currentCacheSize -= snapshot.size;
      }
    }
  }

  /**
   * Warm up cache with commonly used contexts
   */
  async warmUpCache(projectId: string): Promise<void> {
    // Preload common files
    const commonFiles = await this.getCommonFiles(projectId);

    for (const file of commonFiles) {
      const key = this.generateContextKey(projectId, file);
      if (!this.contextCache.has(key)) {
        await this.preloadContext(projectId, file, 0.8);
      }
    }
  }

  /**
   * Get commonly accessed files for a project
   */
  private async getCommonFiles(projectId: string): Promise<string[]> {
    // In real implementation, analyze project structure and access patterns
    // For now, return empty array
    return [];
  }
}

/**
 * Global context manager instance
 */
export const globalContextManager = new ContextManager();
