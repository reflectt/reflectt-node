import {
  type ToolContext,
  validateIdentifier,
  countFilesRecursive,
  getDirectorySize,
  formatError,
} from '@/lib/tools/helpers';

interface GetSpaceInfoInput {
  space_name: string;
  include_contents?: boolean;
}

interface SpaceInfoOutput {
  success: boolean;
  space_name: string;
  description: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, any>;
  path: string;
  stats: {
    agent_count: number;
    task_count: number;
    table_count: number;
    storage_files: number;
    total_size_bytes: number;
  };
  contents?: {
    agents: string[];
    tasks: string[];
    tables: string[];
    storage_categories: string[];
  };
  error?: string;
}

interface SpaceMetadata {
  space_name?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, any>;
}

/**
 * Get detailed information about a specific space
 */
async function getSpaceInfoImpl(
  input: GetSpaceInfoInput,
  ctx: ToolContext
): Promise<SpaceInfoOutput> {
  const { space_name, include_contents = false } = input;

  // Validate space name
  const validation = validateIdentifier(space_name, 'space_name');
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  const spacePath = ctx.resolvePath(space_name as any);

  // Check if space exists
  if (!ctx.fileExists(space_name as any, 'space.json')) {
    throw new Error(`Space "${space_name}" does not exist`);
  }

  // Load metadata with fallback to defaults
  let metadata: SpaceMetadata = {};
  try {
    metadata = await ctx.readJson<SpaceMetadata>(space_name as any, 'space.json');
  } catch {
    // Use defaults
  }

  // Helper to safely count files in recursive directories
  async function safeCountRecursive(dir: string): Promise<number> {
    try {
      return await countFilesRecursive(dir);
    } catch {
      return 0;
    }
  }

  // Helper to safely get directory size
  async function safeGetSize(dir: string): Promise<number> {
    try {
      return await getDirectorySize(dir);
    } catch {
      return 0;
    }
  }

  // Helper to count JSON files
  async function countJsonFiles(subdir: string): Promise<number> {
    try {
      const files = await ctx.listFiles(space_name as any, subdir, '.json');
      return files.length;
    } catch {
      return 0;
    }
  }

  // Helper to count directories
  async function countDirs(subdir: string): Promise<number> {
    try {
      const dirs = await ctx.listDirs(space_name as any, subdir);
      return dirs.length;
    } catch {
      return 0;
    }
  }

  const stats = {
    agent_count: await countJsonFiles('agents'),
    task_count: await safeCountRecursive(ctx.resolvePath(space_name as any, 'tasks')),
    table_count: await countDirs('tables'),
    storage_files: await safeCountRecursive(ctx.resolvePath(space_name as any, 'storage')),
    total_size_bytes: await safeGetSize(spacePath),
  };

  const result: SpaceInfoOutput = {
    success: true,
    space_name: metadata?.space_name || space_name,
    description: metadata?.description || '',
    created_at: metadata?.created_at || '',
    updated_at: metadata?.updated_at || '',
    metadata: metadata?.metadata || {},
    path: spacePath,
    stats,
  };

  // Include contents if requested
  if (include_contents) {
    // List agents (JSON files without extension)
    const agentFiles = await ctx.listFiles(space_name as any, 'agents', '.json').catch(() => []);
    const agents = agentFiles.map(f => f.replace('.json', ''));

    // List tasks (organized by agent subdirectories)
    const tasks: string[] = [];
    try {
      const agentDirs = await ctx.listDirs(space_name as any, 'tasks');
      for (const agentDir of agentDirs) {
        const taskFiles = await ctx.listFiles(space_name as any, 'tasks', agentDir, '.json').catch(() => []);
        tasks.push(...taskFiles.map(f => `${agentDir}/${f.replace('.json', '')}`));
      }
    } catch {
      // Tasks directory doesn't exist or can't be read
    }

    // List tables (subdirectories)
    const tables = await ctx.listDirs(space_name as any, 'tables').catch(() => []);

    // List storage categories (subdirectories)
    const storage_categories = await ctx.listDirs(space_name as any, 'storage').catch(() => []);

    result.contents = {
      agents,
      tasks,
      tables,
      storage_categories,
    };
  }

  return result;
}

export default async function getSpaceInfo(
  input: GetSpaceInfoInput,
  ctx: ToolContext
): Promise<SpaceInfoOutput> {
  try {
    return await getSpaceInfoImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      space_name: input.space_name,
      description: '',
      created_at: '',
      updated_at: '',
      metadata: {},
      path: '',
      stats: {
        agent_count: 0,
        task_count: 0,
        table_count: 0,
        storage_files: 0,
        total_size_bytes: 0,
      },
      error: formatError(error),
    };
  }
}
