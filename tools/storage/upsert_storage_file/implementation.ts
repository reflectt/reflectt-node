import {
  type ToolContext,
  validateIdentifier,
  validateNoPathTraversal,
  formatError,
} from '@/lib/tools/helpers';

interface SaveToStorageInput {
  category: string  // e.g., 'stories', 'characters', 'worlds', 'images'
  filename: string  // e.g., 'my-story.md', 'character-001.json'
  content: string
  target_space?: string  // Optional: save to specific space
}

interface SaveToStorageOutput {
  success: boolean
  path?: string  // Relative path from space root
  full_path?: string  // Absolute filesystem path
  error?: string
}

/**
 * Save a file to the storage/ directory in a space
 *
 * Enforces clean structure:
 * - storage/[category]/[filename]
 *
 * Examples:
 * - storage/stories/my-story.md
 * - storage/characters/hero-profile.json
 * - storage/worlds/fantasy-realm.md
 * - storage/images/map.png
 *
 * This mimics S3-style object storage and keeps spaces organized.
 */
export default async function upsertStorageFile(
  input: SaveToStorageInput,
  ctx: ToolContext
): Promise<SaveToStorageOutput> {
  try {
    const { category, filename, content } = input;

    // Validate inputs
    validateIdentifier(category, 'category');
    validateNoPathTraversal(filename, 'filename');

    // ALWAYS use current space context - ignore any target_space parameter
    // Space-specific agents should only access their own space
    // This is enforced at the tool level for security
    const spaceTarget = undefined; // undefined = use ctx.currentSpace

    // Ensure directory exists
    await ctx.ensureDir(spaceTarget as any, 'storage', category);

    // Check if file already exists (update vs create)
    const fileExists = ctx.fileExists(spaceTarget as any, 'storage', category, filename);
    const operation = fileExists ? 'updated' : 'created';

    // Write file
    await ctx.writeText(spaceTarget as any, 'storage', category, filename, content);

    const fullPath = ctx.resolvePath(spaceTarget as any, 'storage', category, filename);
    const relativePath = `storage/${category}/${filename}`;

    // Trigger storage operation event (non-blocking)
    try {
      await ctx.executeTool('trigger_event', {
        event_type: fileExists ? 'storage.file_updated' : 'storage.file_created',
        space_id: spaceTarget,
        data: {
          category,
          filename,
          path: relativePath,
          operation,
          file_size: content.length,
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'upsert_storage_file',
          operation: `file_${operation}`
        }
      });
    } catch (eventError) {
      console.warn(`Failed to trigger event: ${eventError}`);
    }

    return {
      success: true,
      path: relativePath,
      full_path: fullPath
    };
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
