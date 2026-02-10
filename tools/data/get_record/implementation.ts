import {
  type ToolContext,
  validateIdentifier,
  validateNoPathTraversal,
  withErrorHandling,
} from '@/lib/tools/helpers';

interface GetRecordInput {
  table: string;
  id: string;
  target_space?: string;
}

interface GetRecordOutput {
  success: boolean;
  record?: any;
  path?: string;
  error?: string;
}

export default async function get_record(
  input: GetRecordInput,
  ctx: ToolContext
): Promise<GetRecordOutput> {
  return withErrorHandling(async () => {
    const { table, id } = input;

    // Validate inputs
    validateIdentifier(table, 'table name');
    validateNoPathTraversal(id, 'record ID');

    // ALWAYS use current space context
    const spaceTarget = undefined;

    // Read and return the record using ToolContext
    const record = await ctx.readJson(spaceTarget, 'tables', table, 'rows', `${id}.json`);

    return {
      success: true,
      record,
      path: `tables/${table}/rows/${id}.json`
    };
  });
}
