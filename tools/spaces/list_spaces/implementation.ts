import {
  type ToolContext,
} from '@/lib/tools/helpers/tool-context'
import {
  formatError,
  countFilesRecursive,
} from '@/lib/tools/helpers'

interface ListSpacesInput {
  include_stats?: boolean;
  filter_tag?: string;
}

interface SpaceInfo {
  space_name: string;
  description: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, any>;
  stats?: {
    agent_count: number;
    task_count: number;
    table_count: number;
    storage_files: number;
  };
}

interface ListSpacesOutput {
  success: boolean;
  count: number;
  spaces: SpaceInfo[];
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
 * List all available spaces
 */
async function listSpacesImpl(
  input: ListSpacesInput,
  ctx: ToolContext
): Promise<ListSpacesOutput> {
  const { include_stats = false, filter_tag } = input;

  // List spaces via ToolContext - adapter handles both Supabase and filesystem modes
  const spaces: SpaceInfo[] = [];

  try {
    // List all spaces - adapter routes to spaces table (Supabase) or data/spaces/ (filesystem)
    const spaceNames = await ctx.listDirs(undefined, 'spaces');

    for (const spaceName of spaceNames) {
      // Read space metadata via ToolContext - adapter handles routing
      let spaceRecord: any = null;
      try {
        spaceRecord = await ctx.readJson(spaceName as any, 'space.json');
      } catch {
        // No metadata file, use minimal defaults
      }

      const spaceData: SpaceInfo = {
        space_name: spaceRecord?.space_name || spaceName,
        description: spaceRecord?.description || '',
        created_at: spaceRecord?.created_at || '',
        updated_at: spaceRecord?.updated_at || '',
        metadata: spaceRecord?.metadata || {},
      };

      // Filter by tag if specified
      if (filter_tag) {
        const tags = spaceData.metadata.tags || [];
        if (!Array.isArray(tags) || !tags.includes(filter_tag)) {
          continue;
        }
      }

      // Add stats if requested
      if (include_stats) {
        // Safe count helpers
        const safeCountDirs = async (dir: string) => {
          try {
            const dirs = await ctx.listDirs(spaceName as any, dir);
            return dirs.length;
          } catch {
            return 0;
          }
        };

        const safeCountRecursive = async (dir: string) => {
          try {
            const dirPath = ctx.resolvePath(spaceName as any, dir);
            return await countFilesRecursive(dirPath);
          } catch {
            return 0;
          }
        };

        spaceData.stats = {
          agent_count: await safeCountDirs('agents'),
          task_count: await safeCountRecursive('tasks'),
          table_count: await safeCountDirs('tables'),
          storage_files: await safeCountRecursive('storage'),
        };
      }

      spaces.push(spaceData);
    }
  } catch (error) {
    // Handle gracefully - return empty list if spaces can't be listed
    console.error('[list_spaces] Failed to list spaces:', error);
    return {
      success: true,
      count: 0,
      spaces: [],
    };
  }

  return {
    success: true,
    count: spaces.length,
    spaces,
  };
}

export default async function listSpaces(
  input: ListSpacesInput,
  ctx: ToolContext
): Promise<ListSpacesOutput> {
  try {
    return await listSpacesImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      count: 0,
      spaces: [],
      error: formatError(error),
    };
  }
}
