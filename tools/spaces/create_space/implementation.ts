import fs from 'fs/promises';
import {
  type ToolContext,
  validateIdentifier,
  now,
  formatError,
} from '@/lib/tools/helpers';

interface CreateSpaceInput {
  space_name: string;
  description?: string;
  metadata?: Record<string, any>;
}

interface CreateSpaceOutput {
  success: boolean;
  space_name: string;
  path: string;
  message: string;
  created_at: string;
  error?: string;
}

/**
 * Create a new space with directory structure and metadata
 */
async function createSpaceImpl(
  input: CreateSpaceInput,
  ctx: ToolContext
): Promise<CreateSpaceOutput> {
  const { space_name, description, metadata } = input;

  // Validate space name
  const validation = validateIdentifier(space_name, 'space_name');
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  const spacePath = ctx.resolvePath(space_name as any);

  // Check if space already exists
  if (ctx.fileExists(space_name as any, 'space.json')) {
    throw new Error(`Space '${space_name}' already exists at ${spacePath}`);
  }

  try {
    // Create space metadata file
    const created_at = now();
    const spaceMetadata = {
      space_name,
      description: description || '',
      created_at,
      updated_at: created_at,
      metadata: metadata || {},
    };

    // Write space.json (will route to database if DATA_BACKEND=database)
    await ctx.writeJson(space_name as any, 'space.json', spaceMetadata);

    // Only create filesystem directories if using filesystem backend
    const useDatabase = process.env.DATA_BACKEND === 'database';
    if (!useDatabase) {
      const subdirs = ['agents', 'tasks', 'tables', 'storage'];
      for (const subdir of subdirs) {
        await ctx.ensureDir(space_name as any, subdir);
      }
    }

    // Add current user as owner in space_members table (database mode only)
    if (useDatabase && ctx.userId) {
      const { getSupabaseClient } = await import('@/lib/data/utils/supabase-client');
      const supabase = getSupabaseClient();

      const { error: memberError } = await supabase
        .from('space_members')
        .insert({
          space_id: space_name,
          user_id: ctx.userId,
          role: 'owner',
          status: 'active'
        });

      if (memberError) {
        console.error('[create_space] Failed to add user as owner:', memberError);
        // Don't fail the whole operation, just log the error
      }
    }

    return {
      success: true,
      space_name,
      path: spacePath,
      message: `Space '${space_name}' created successfully`,
      created_at,
    };
  } catch (error) {
    // Cleanup on failure
    try {
      await fs.rm(spacePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

export default async function createSpace(
  input: CreateSpaceInput,
  ctx: ToolContext
): Promise<CreateSpaceOutput> {
  try {
    return await createSpaceImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      space_name: input.space_name,
      path: '',
      message: formatError(error),
      created_at: '',
      error: formatError(error),
    };
  }
}
