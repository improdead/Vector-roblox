/**
 * Virtual Roblox Studio Environment
 *
 * Simulates a Roblox Studio environment in-memory for testing the Vector agent.
 * Provides:
 * - In-memory file system for Lua/Luau scripts
 * - Instance hierarchy (Workspace, ReplicatedStorage, etc.)
 * - Active script and selection state
 * - Change tracking for debugging
 * - Context generation for agent API calls
 *
 * @module testing/runner/virtual-env
 */

/**
 * Represents a script file in the virtual environment
 */
export interface VirtualFile {
  path: string;              // e.g., "game.ServerScriptService.MainScript"
  content: string;           // The actual Lua/Luau code
  language: 'lua' | 'luau';  // Script language
  created: number;           // Timestamp when created
  modified: number;          // Timestamp when last modified
}

/**
 * Represents a Roblox instance in the virtual hierarchy
 */
export interface VirtualInstance {
  path: string;                      // e.g., "game.Workspace.Part1"
  className: string;                 // e.g., "Part", "Script", "Folder"
  name: string;                      // e.g., "Part1"
  parent: string | null;             // Parent path, or null for root
  children: string[];                // Array of child instance paths
  properties: Record<string, any>;   // Instance properties (Color, Size, etc.)
}

/**
 * Tracks a single change made to the virtual environment
 */
export interface Change {
  timestamp: number;
  type: 'file_create' | 'file_update' | 'file_delete' |
        'instance_create' | 'instance_delete' | 'property_set' | 'instance_rename';
  target: string;        // Path to the affected file/instance
  before?: any;          // State before change
  after?: any;           // State after change
  toolCall?: string;     // Which tool made this change
  description?: string;  // Human-readable description
}

/**
 * Serialized state for export/import
 */
export interface SerializedState {
  files: [string, VirtualFile][];
  instances: [string, VirtualInstance][];
  activeScript: string | null;
  selection: string[];
  changes: Change[];
}

/**
 * Virtual Environment Class
 *
 * Manages the complete simulated Roblox Studio environment.
 * All operations are tracked and can be exported for debugging.
 */
export class VirtualEnvironment {
  // File System
  private files: Map<string, VirtualFile> = new Map();

  // Instance Hierarchy
  private instances: Map<string, VirtualInstance> = new Map();

  // Current State
  private activeScript: string | null = null;
  private selection: string[] = [];

  // Change History
  private changes: Change[] = [];

  // Logging
  private verbose: boolean = false;

  /**
   * Create a new virtual environment
   * @param initialState - Optional initial state to restore from
   * @param verbose - Enable detailed logging
   */
  constructor(initialState?: Partial<SerializedState>, verbose: boolean = false) {
    this.verbose = verbose;
    this.log('📦 Initializing Virtual Environment');

    if (initialState) {
      this.importState(initialState);
    } else {
      this.setupDefaultState();
    }

    this.log(`✅ Virtual Environment ready (${this.files.size} files, ${this.instances.size} instances)`);
  }

  // ============================================================================
  // FILE OPERATIONS
  // ============================================================================

  /**
   * Create a new script file
   * @param path - Full path (e.g., "game.ServerScriptService.MainScript")
   * @param content - Script content
   * @param language - Script language (defaults to 'lua')
   */
  createFile(path: string, content: string, language: 'lua' | 'luau' = 'lua'): void {
    this.log(`📝 Creating file: ${path}`);

    if (this.files.has(path)) {
      throw new Error(`File already exists: ${path}`);
    }

    const now = Date.now();
    const file: VirtualFile = {
      path,
      content,
      language,
      created: now,
      modified: now
    };

    this.files.set(path, file);

    this.trackChange({
      type: 'file_create',
      target: path,
      after: { content, language },
      description: `Created ${language} file: ${path}`
    });

    this.log(`✅ File created: ${path} (${content.length} chars)`);
  }

  /**
   * Update an existing script file
   * @param path - File path
   * @param content - New content
   */
  updateFile(path: string, content: string): void {
    this.log(`📝 Updating file: ${path}`);

    const file = this.files.get(path);
    if (!file) {
      throw new Error(`File not found: ${path}`);
    }

    const before = file.content;
    file.content = content;
    file.modified = Date.now();

    this.trackChange({
      type: 'file_update',
      target: path,
      before,
      after: content,
      description: `Updated file: ${path}`
    });

    this.log(`✅ File updated: ${path} (${before.length} → ${content.length} chars)`);
  }

  /**
   * Delete a script file
   * @param path - File path
   */
  deleteFile(path: string): void {
    this.log(`🗑️ Deleting file: ${path}`);

    const file = this.files.get(path);
    if (!file) {
      throw new Error(`File not found: ${path}`);
    }

    this.files.delete(path);

    this.trackChange({
      type: 'file_delete',
      target: path,
      before: file,
      description: `Deleted file: ${path}`
    });

    this.log(`✅ File deleted: ${path}`);
  }

  /**
   * Get a file by path
   * @param path - File path
   * @returns The file, or null if not found
   */
  getFile(path: string): VirtualFile | null {
    return this.files.get(path) || null;
  }

  /**
   * Get all files
   * @returns Array of all files
   */
  getAllFiles(): VirtualFile[] {
    return Array.from(this.files.values());
  }

  // ============================================================================
  // INSTANCE OPERATIONS
  // ============================================================================

  /**
   * Create a new instance in the hierarchy
   * @param parent - Parent instance path
   * @param className - Instance class (e.g., "Part", "Script")
   * @param name - Instance name
   * @param properties - Optional initial properties
   * @returns The created instance
   */
  createInstance(
    parent: string,
    className: string,
    name: string,
    properties: Record<string, any> = {}
  ): VirtualInstance {
    this.log(`🔨 Creating instance: ${className} "${name}" in ${parent}`);

    // Verify parent exists
    const parentInstance = this.instances.get(parent);
    if (!parentInstance) {
      throw new Error(`Parent not found: ${parent}`);
    }

    // Generate unique path
    const path = `${parent}.${name}`;

    // Check for duplicates
    if (this.instances.get(path)) {
      throw new Error(`Instance already exists: ${path}`);
    }

    // Create instance
    const instance: VirtualInstance = {
      path,
      className,
      name,
      parent,
      children: [],
      properties: { ...properties }
    };

    this.instances.set(path, instance);

    // Add to parent's children
    parentInstance.children.push(path);

    this.trackChange({
      type: 'instance_create',
      target: path,
      after: { className, name, properties },
      description: `Created ${className}: ${path}`
    });

    this.log(`✅ Instance created: ${path}`);

    return instance;
  }

  /**
   * Set properties on an instance
   * @param path - Instance path
   * @param props - Properties to set
   */
  setProperties(path: string, props: Record<string, any>): void {
    this.log(`⚙️ Setting properties on: ${path}`);

    const instance = this.instances.get(path);
    if (!instance) {
      throw new Error(`Instance not found: ${path}`);
    }

    const before = { ...instance.properties };
    Object.assign(instance.properties, props);

    this.trackChange({
      type: 'property_set',
      target: path,
      before,
      after: instance.properties,
      description: `Set ${Object.keys(props).length} properties on ${path}`
    });

    this.log(`✅ Properties set: ${Object.keys(props).join(', ')}`);
  }

  /**
   * Rename an instance
   * @param path - Current instance path
   * @param newName - New name
   */
  renameInstance(path: string, newName: string): void {
    this.log(`✏️ Renaming instance: ${path} → ${newName}`);

    const instance = this.instances.get(path);
    if (!instance) {
      throw new Error(`Instance not found: ${path}`);
    }

    const oldPath = path;
    const newPath = instance.parent ? `${instance.parent}.${newName}` : newName;

    // Update instance
    instance.name = newName;
    instance.path = newPath;

    // Re-key in map
    this.instances.delete(oldPath);
    this.instances.set(newPath, instance);

    // Update parent's children
    if (instance.parent) {
      const parent = this.instances.get(instance.parent);
      if (parent) {
        const idx = parent.children.indexOf(oldPath);
        if (idx !== -1) {
          parent.children[idx] = newPath;
        }
      }
    }

    // Update children paths recursively
    this.updateChildrenPaths(oldPath, newPath);

    this.trackChange({
      type: 'instance_rename',
      target: newPath,
      before: oldPath,
      after: newPath,
      description: `Renamed: ${oldPath} → ${newPath}`
    });

    this.log(`✅ Instance renamed: ${newPath}`);
  }

  /**
   * Delete an instance and all its children
   * @param path - Instance path
   */
  deleteInstance(path: string): void {
    this.log(`🗑️ Deleting instance: ${path}`);

    const instance = this.instances.get(path);
    if (!instance) {
      throw new Error(`Instance not found: ${path}`);
    }

    // Delete children recursively
    for (const childPath of [...instance.children]) {
      this.deleteInstance(childPath);
    }

    // Remove from parent's children
    if (instance.parent) {
      const parent = this.instances.get(instance.parent);
      if (parent) {
        parent.children = parent.children.filter(c => c !== path);
      }
    }

    // Delete instance
    this.instances.delete(path);

    this.trackChange({
      type: 'instance_delete',
      target: path,
      before: instance,
      description: `Deleted instance: ${path}`
    });

    this.log(`✅ Instance deleted: ${path}`);
  }

  /**
   * Get an instance by path
   * @param path - Instance path
   * @returns The instance, or null if not found
   */
  getInstance(path: string): VirtualInstance | null {
    return this.instances.get(path) || null;
  }

  /**
   * Get all children of an instance
   * @param path - Parent instance path
   * @returns Array of child instances
   */
  getChildren(path: string): VirtualInstance[] {
    const instance = this.instances.get(path);
    if (!instance) return [];

    return instance.children
      .map(childPath => this.instances.get(childPath))
      .filter((inst): inst is VirtualInstance => inst !== undefined);
  }

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  /**
   * Set the active script
   * @param path - Script path, or null to clear
   */
  setActiveScript(path: string | null): void {
    this.log(`📄 Setting active script: ${path || 'none'}`);

    if (path && !this.files.has(path)) {
      throw new Error(`File not found: ${path}`);
    }

    this.activeScript = path;
  }

  /**
   * Get the active script
   * @returns The active script file, or null
   */
  getActiveScript(): VirtualFile | null {
    if (!this.activeScript) return null;
    return this.files.get(this.activeScript) || null;
  }

  /**
   * Set the current selection
   * @param paths - Array of instance paths
   */
  setSelection(paths: string[]): void {
    this.log(`🎯 Setting selection: [${paths.join(', ')}]`);

    // Verify all paths exist
    for (const path of paths) {
      if (!this.instances.has(path)) {
        throw new Error(`Instance not found: ${path}`);
      }
    }

    this.selection = [...paths];
  }

  /**
   * Get the current selection
   * @returns Array of selected instances
   */
  getSelection(): VirtualInstance[] {
    return this.selection
      .map(path => this.instances.get(path))
      .filter((inst): inst is VirtualInstance => inst !== undefined);
  }

  // ============================================================================
  // CONTEXT GENERATION
  // ============================================================================

  /**
   * Generate context for agent API calls
   * Converts virtual environment state to the format expected by /api/chat
   * @returns Chat context object
   */
  getContext(): any {
    this.log('📋 Generating context for agent');

    const activeFile = this.getActiveScript();

    const context = {
      activeScript: activeFile ? {
        path: activeFile.path,
        text: activeFile.content
      } : null,

      selection: this.selection.map(path => {
        const instance = this.instances.get(path);
        return {
          className: instance?.className || '',
          path: path
        };
      }),

      openDocs: Array.from(this.files.values())
        .filter(f => f.path !== this.activeScript)
        .map(f => ({ path: f.path })),

      scene: {
        nodes: Array.from(this.instances.values()).map(inst => ({
          path: inst.path,
          className: inst.className,
          name: inst.name,
          parentPath: inst.parent || undefined,
          props: inst.properties
        }))
      },

      codeDefinitions: [] // Could parse files for functions/classes
    };

    this.log(`✅ Context generated (${context.scene.nodes.length} instances, ${this.files.size} files)`);

    return context;
  }

  // ============================================================================
  // CHANGE TRACKING
  // ============================================================================

  /**
   * Track a change for debugging
   * @param change - Change to track
   */
  private trackChange(change: Omit<Change, 'timestamp'>): void {
    this.changes.push({
      timestamp: Date.now(),
      ...change
    });
  }

  /**
   * Get all tracked changes
   * @returns Array of changes
   */
  getChanges(): Change[] {
    return [...this.changes];
  }

  /**
   * Clear change history
   */
  clearChanges(): void {
    this.changes = [];
    this.log('🧹 Cleared change history');
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  /**
   * Export current state
   * @returns Serialized state object
   */
  exportState(): SerializedState {
    this.log('💾 Exporting state');

    return {
      files: Array.from(this.files.entries()),
      instances: Array.from(this.instances.entries()),
      activeScript: this.activeScript,
      selection: [...this.selection],
      changes: [...this.changes]
    };
  }

  /**
   * Import state from serialized format
   * @param state - Serialized state
   */
  importState(state: Partial<SerializedState>): void {
    this.log('📥 Importing state');

    if (state.files) {
      this.files = new Map(state.files);
    }

    if (state.instances) {
      this.instances = new Map(state.instances);
    }

    if (state.activeScript !== undefined) {
      this.activeScript = state.activeScript;
    }

    if (state.selection) {
      this.selection = [...state.selection];
    }

    if (state.changes) {
      this.changes = [...state.changes];
    }

    this.log('✅ State imported');
  }

  /**
   * Reset to default state
   */
  reset(): void {
    this.log('🔄 Resetting to default state');

    this.files.clear();
    this.instances.clear();
    this.activeScript = null;
    this.selection = [];
    this.changes = [];

    this.setupDefaultState();

    this.log('✅ Reset complete');
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Setup default Roblox Studio state
   * Creates the standard game hierarchy and a sample script
   */
  private setupDefaultState(): void {
    this.log('🏗️ Setting up default state');

    // Create root DataModel
    this.instances.set('game', {
      path: 'game',
      className: 'DataModel',
      name: 'Game',
      parent: null,
      children: [],
      properties: {}
    });

    // Create standard services
    const services = [
      { name: 'Workspace', className: 'Workspace' },
      { name: 'ReplicatedStorage', className: 'ReplicatedStorage' },
      { name: 'ServerScriptService', className: 'ServerScriptService' },
      { name: 'ServerStorage', className: 'ServerStorage' },
      { name: 'StarterPlayer', className: 'StarterPlayer' },
      { name: 'StarterGui', className: 'StarterGui' },
      { name: 'Players', className: 'Players' }
    ];

    const game = this.instances.get('game')!;

    for (const service of services) {
      const path = `game.${service.name}`;
      this.instances.set(path, {
        path,
        className: service.className,
        name: service.name,
        parent: 'game',
        children: [],
        properties: {}
      });
      game.children.push(path);
    }

    // Create a default script
    const scriptPath = 'game.ServerScriptService.MainScript';
    this.createFile(
      scriptPath,
      `-- MainScript.lua\n-- Generated by Vector Test Environment\n\nprint("Hello from Vector!")\n\n-- Add your code here\n`,
      'lua'
    );

    // Set it as active
    this.activeScript = scriptPath;

    this.log('✅ Default state ready');
  }

  /**
   * Update all children paths recursively when parent is renamed
   * @param oldParentPath - Old parent path
   * @param newParentPath - New parent path
   */
  private updateChildrenPaths(oldParentPath: string, newParentPath: string): void {
    const instance = this.instances.get(newParentPath);
    if (!instance) return;

    for (let i = 0; i < instance.children.length; i++) {
      const oldChildPath = instance.children[i];
      const childName = oldChildPath.split('.').pop()!;
      const newChildPath = `${newParentPath}.${childName}`;

      const child = this.instances.get(oldChildPath);
      if (child) {
        child.path = newChildPath;
        child.parent = newParentPath;

        this.instances.delete(oldChildPath);
        this.instances.set(newChildPath, child);

        instance.children[i] = newChildPath;

        // Recurse
        this.updateChildrenPaths(oldChildPath, newChildPath);
      }
    }
  }

  /**
   * Log a message if verbose mode is enabled
   * @param message - Message to log
   */
  private log(message: string): void {
    if (this.verbose) {
      console.log(`[VirtualEnv] ${message}`);
    }
  }
}
