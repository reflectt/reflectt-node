import {
  type ToolContext,
  validateIdentifier,
  validateNoPathTraversal,
  formatError,
} from '@/lib/tools/helpers';

interface GetFromStorageInput {
  category: string;
  filename: string;
  target_space?: string;
}

interface GetFromStorageOutput {
  success: boolean;
  content?: string;
  path?: string;
  error?: string;
}

export default async function get_from_storage(
  input: GetFromStorageInput,
  ctx: ToolContext
): Promise<GetFromStorageOutput> {
  try {
    const { category, filename } = input;

    // Validate inputs
    validateIdentifier(category, 'category');
    validateNoPathTraversal(filename, 'filename');

    // ALWAYS use current space context - ignore any target_space parameter
    const spaceTarget = undefined;

    // Read the file
    const content = await ctx.readText(spaceTarget as any, 'storage', category, filename);

    return {
      success: true,
      content,
      path: `storage/${category}/${filename}`
    };
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
