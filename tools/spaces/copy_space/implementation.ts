import {
  type ToolContext,
  validateIdentifier,
  copyDirectoryRecursive,
  now,
  formatError,
} from '@/lib/tools/helpers';

interface CopySpaceInput {
  source_space: string;
  destination_space: string;
  overwrite?: boolean;
  include_agents?: boolean;
  include_tasks?: boolean;
  include_tables?: boolean;
  include_storage?: boolean;
}

interface CopySpaceOutput {
  success: boolean;
  source_space: string;
  destination_space: string;
  message: string;
  copied_at: string;
  stats: {
    agents_copied: number;
    tasks_copied: number;
    tables_copied: number;
    storage_files_copied: number;
  };
  error?: string;
}

/**
 * Copy all data from one space to another
 */
async function copySpaceImpl(
  input: CopySpaceInput,
  ctx: ToolContext
): Promise<CopySpaceOutput> {
  const {
    source_space,
    destination_space,
    overwrite = false,
    include_agents = true,
    include_tasks = true,
    include_tables = true,
    include_storage = true,
  } = input;

  // Validate space names
  const sourceValidation = validateIdentifier(source_space, 'source_space');
  if (!sourceValidation.valid) {
    throw new Error(sourceValidation.errors[0].message);
  }

  const destValidation = validateIdentifier(destination_space, 'destination_space');
  if (!destValidation.valid) {
    throw new Error(destValidation.errors[0].message);
  }

  const sourcePath = ctx.resolvePath(source_space as any);
  const destPath = ctx.resolvePath(destination_space as any);

  // Check if source space exists
  if (!ctx.fileExists(source_space as any, 'space.json')) {
    throw new Error(`Source space '${source_space}' does not exist`);
  }

  // Check if destination exists
  const destExists = ctx.fileExists(destination_space as any, 'space.json');
  if (destExists && !overwrite) {
    throw new Error(
      `Destination space '${destination_space}' already exists. Set overwrite=true to overwrite files.`
    );
  }

  // Create destination space if it doesn't exist
  if (!destExists) {
    const subdirs = ['agents', 'tasks', 'tables', 'storage'];
    for (const subdir of subdirs) {
      await ctx.ensureDir(destination_space as any, subdir);
    }
  }

  const stats = {
    agents_copied: 0,
    tasks_copied: 0,
    tables_copied: 0,
    storage_files_copied: 0,
  };

  // Copy agents
  if (include_agents) {
    const srcAgents = ctx.resolvePath(source_space as any, 'agents');
    const destAgents = ctx.resolvePath(destination_space as any, 'agents');
    stats.agents_copied = await copyDirectoryRecursive(srcAgents, destAgents, overwrite);
  }

  // Copy tasks
  if (include_tasks) {
    const srcTasks = ctx.resolvePath(source_space as any, 'tasks');
    const destTasks = ctx.resolvePath(destination_space as any, 'tasks');
    stats.tasks_copied = await copyDirectoryRecursive(srcTasks, destTasks, overwrite);
  }

  // Copy tables
  if (include_tables) {
    const srcTables = ctx.resolvePath(source_space as any, 'tables');
    const destTables = ctx.resolvePath(destination_space as any, 'tables');
    stats.tables_copied = await copyDirectoryRecursive(srcTables, destTables, overwrite);
  }

  // Copy storage
  if (include_storage) {
    const srcStorage = ctx.resolvePath(source_space as any, 'storage');
    const destStorage = ctx.resolvePath(destination_space as any, 'storage');
    stats.storage_files_copied = await copyDirectoryRecursive(srcStorage, destStorage, overwrite);
  }

  // Copy or create metadata
  const created_at = now();
  let metadata: any = {};

  try {
    metadata = await ctx.readJson(source_space as any, 'space.json');
  } catch {
    // No source metadata, create new
  }

  metadata.space_name = destination_space;
  metadata.created_at = created_at;
  metadata.updated_at = created_at;
  metadata.metadata = metadata.metadata || {};
  metadata.metadata.copied_from = source_space;
  metadata.metadata.copied_at = created_at;

  await ctx.writeJson(destination_space as any, 'space.json', metadata);

  return {
    success: true,
    source_space,
    destination_space,
    message: `Successfully copied space '${source_space}' to '${destination_space}'`,
    copied_at: created_at,
    stats,
  };
}

export default async function copySpace(
  input: CopySpaceInput,
  ctx: ToolContext
): Promise<CopySpaceOutput> {
  try {
    return await copySpaceImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      source_space: input.source_space,
      destination_space: input.destination_space,
      message: '',
      error: formatError(error),
      copied_at: '',
      stats: {
        agents_copied: 0,
        tasks_copied: 0,
        tables_copied: 0,
        storage_files_copied: 0,
      },
    };
  }
}
