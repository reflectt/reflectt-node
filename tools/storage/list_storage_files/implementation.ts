import * as fs from 'fs/promises';
import {
  type ToolContext,
  validateIdentifier,
  formatError,
} from '@/lib/tools/helpers';

interface ListStorageInput {
  category: string;
  pattern?: string;
  target_space?: string;
}

interface StorageFile {
  filename: string;
  path: string;
  size: number;
  modified: string;
}

interface ListStorageOutput {
  success: boolean;
  files?: StorageFile[];
  count?: number;
  error?: string;
}

export default async function list_storage(
  input: ListStorageInput,
  ctx: ToolContext
): Promise<ListStorageOutput> {
  try {
    const { category, pattern } = input;

    // Validate inputs
    validateIdentifier(category, 'category');

    // ALWAYS use current space context - ignore any target_space parameter
    const spaceTarget = undefined;

    // Check if category exists
    const categoryPath = ctx.resolvePath(spaceTarget as any, 'storage', category);

    let entries;
    try {
      entries = await fs.readdir(categoryPath, { withFileTypes: true });
    } catch {
      // Category doesn't exist - return empty list
      return {
        success: true,
        files: [],
        count: 0
      };
    }

    // Get files only
    const filenames = entries
      .filter(entry => entry.isFile())
      .map(entry => entry.name);

    // Filter by pattern if provided
    const filteredFilenames = pattern
      ? filenames.filter(f => f.includes(pattern))
      : filenames;

    // Get file details
    const files: StorageFile[] = await Promise.all(
      filteredFilenames.map(async (filename) => {
        const filePath = categoryPath + '/' + filename;
        const stats = await fs.stat(filePath);

        return {
          filename,
          path: `storage/${category}/${filename}`,
          size: stats.size,
          modified: stats.mtime.toISOString()
        };
      })
    );

    // Sort by modified date (newest first)
    files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    return {
      success: true,
      files,
      count: files.length
    };
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
