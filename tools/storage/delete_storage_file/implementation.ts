import * as fs from 'fs/promises';
import {
  type ToolContext,
  validateIdentifier,
  validateNoPathTraversal,
  formatError,
} from '@/lib/tools/helpers';

interface DeleteFromStorageInput {
  category: string;
  filename: string;
  target_space?: string;
}

interface DeleteFromStorageOutput {
  success: boolean;
  path?: string;
  error?: string;
}

export default async function delete_from_storage(
  input: DeleteFromStorageInput,
  ctx: ToolContext
): Promise<DeleteFromStorageOutput> {
  try {
    const { category, filename } = input;

    // Validate inputs
    validateIdentifier(category, 'category');
    validateNoPathTraversal(filename, 'filename');

    // ALWAYS use current space context - ignore any target_space parameter
    const spaceTarget = undefined;

    // Delete the file
    const filePath = ctx.resolvePath(spaceTarget as any, 'storage', category, filename);
    
    // Get file size before deletion for event context
    let fileSize = 0;
    try {
      const stats = await fs.stat(filePath);
      fileSize = stats.size;
    } catch {
      // If we can't get size, proceed with deletion anyway
    }
    
    await fs.unlink(filePath);

    // Try to remove the category directory if it's empty
    const categoryPath = ctx.resolvePath(spaceTarget as any, 'storage', category);
    try {
      const remainingFiles = await fs.readdir(categoryPath);
      if (remainingFiles.length === 0) {
        await fs.rmdir(categoryPath);
      }
    } catch {
      // Ignore errors when trying to remove directory
    }

    // Trigger storage deletion event (non-blocking)
    try {
      await ctx.executeTool('trigger_event', {
        event_type: 'storage.file_deleted',
        space_id: spaceTarget,
        data: {
          category,
          filename,
          path: `storage/${category}/${filename}`,
          file_size: fileSize,
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'delete_storage_file',
          operation: 'file_deleted'
        }
      });
    } catch (eventError) {
      console.warn(`Failed to trigger event: ${eventError}`);
    }

    return {
      success: true,
      path: `storage/${category}/${filename}`
    };
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
