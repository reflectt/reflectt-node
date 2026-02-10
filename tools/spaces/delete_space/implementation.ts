import fs from 'fs/promises';
import {
  type ToolContext,
  validateIdentifier,
  now,
  formatError,
} from '@/lib/tools/helpers';

interface DeleteSpaceInput {
  space_name: string;
  confirm: boolean;
}

interface DeleteSpaceOutput {
  success: boolean;
  space_name: string;
  message: string;
  deleted_at: string;
  error?: string;
}

/**
 * Delete a space and all its data permanently
 */
async function deleteSpaceImpl(
  input: DeleteSpaceInput,
  ctx: ToolContext
): Promise<DeleteSpaceOutput> {
  const { space_name, confirm } = input;

  // Validate space name
  const validation = validateIdentifier(space_name, 'space_name');
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  // Require confirmation
  if (!confirm) {
    throw new Error(
      'Deletion not confirmed. Set confirm=true to delete the space permanently.'
    );
  }

  const spacePath = ctx.resolvePath(space_name as any);

  // Check if space exists
  if (!ctx.fileExists(space_name as any, 'space.json')) {
    throw new Error(`Space '${space_name}' does not exist`);
  }

  // Delete the entire space directory
  await fs.rm(spacePath, { recursive: true, force: true });

  return {
    success: true,
    space_name,
    message: `Space '${space_name}' and all its data have been permanently deleted`,
    deleted_at: now(),
  };
}

export default async function deleteSpace(
  input: DeleteSpaceInput,
  ctx: ToolContext
): Promise<DeleteSpaceOutput> {
  try {
    return await deleteSpaceImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      space_name: input.space_name,
      message: formatError(error),
      deleted_at: '',
      error: formatError(error),
    };
  }
}
