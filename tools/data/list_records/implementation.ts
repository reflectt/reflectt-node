import {
  type ToolContext,
  validateIdentifier,
  withErrorHandling,
} from '@/lib/tools/helpers';

interface ListRecordsInput {
  table: string;
  limit?: number;
  offset?: number;
  target_space?: string;
}

interface ListRecordsOutput {
  success: boolean;
  records?: any[];
  count?: number;
  total?: number;
  error?: string;
}

export default async function list_records(
  input: ListRecordsInput,
  ctx: ToolContext
): Promise<ListRecordsOutput> {
  return withErrorHandling(async () => {
    const { table, limit, offset = 0 } = input;

    // Validate inputs
    validateIdentifier(table, 'table name');

    // ALWAYS use current space context
    const spaceTarget = undefined;

    // Check if table exists using ToolContext
    if (!await ctx.fileExists(spaceTarget, 'tables', table, 'rows')) {
      return {
        success: true,
        records: [],
        count: 0,
        total: 0
      };
    }

    // Read all record files using ToolContext
    const filenames = await ctx.listFiles(spaceTarget, 'tables', table, 'rows', '.json');

    // Load all records
    const allRecords = await Promise.all(
      filenames.map(async filename => {
        return await ctx.readJson(spaceTarget, 'tables', table, 'rows', filename);
      })
    );

    // Sort by created_at (newest first) if available
    allRecords.sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });

    const total = allRecords.length;

    // Apply pagination
    const startIndex = offset;
    const endIndex = limit ? startIndex + limit : allRecords.length;
    const records = allRecords.slice(startIndex, endIndex);

    return {
      success: true,
      records,
      count: records.length,
      total
    };
  });
}
