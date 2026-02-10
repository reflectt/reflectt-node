import {
  type ToolContext,
  validateIdentifier,
  validateNoPathTraversal,
  withErrorHandling,
} from '@/lib/tools/helpers';

interface DeleteRecordInput {
  table: string;
  id: string;
  target_space?: string;
}

interface DeleteRecordOutput {
  success: boolean;
  path?: string;
  error?: string;
}

export default async function delete_record(
  input: DeleteRecordInput,
  ctx: ToolContext
): Promise<DeleteRecordOutput> {
  return withErrorHandling(async () => {
    const { table, id } = input;

    // Validate inputs
    validateIdentifier(table, 'table name');
    validateNoPathTraversal(id, 'record ID');

    // ALWAYS use current space context
    const spaceTarget = undefined;

    // Check if record exists
    if (!ctx.fileExists(spaceTarget, 'tables', table, 'rows', `${id}.json`)) {
      throw new Error(`Record not found: ${table}/${id}`);
    }

    // Read record before deletion for event context
    let recordData: any = null;
    try {
      recordData = await ctx.readJson(spaceTarget, 'tables', table, 'rows', `${id}.json`);
    } catch {
      // If we can't read the record, proceed with deletion anyway
    }

    // Delete the record
    await ctx.deleteFile(spaceTarget, 'tables', table, 'rows', `${id}.json`);

    // Trigger event (non-blocking)
    try {
      await ctx.executeTool('trigger_event', {
        event_type: 'data.record_deleted',
        space_id: spaceTarget,
        data: {
          table,
          record_id: id,
          deleted_record: recordData,
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'delete_record',
          operation: 'record_deleted'
        }
      });
    } catch (eventError) {
      console.warn(`Failed to trigger event: ${eventError}`);
    }

    return {
      success: true,
      path: `tables/${table}/rows/${id}.json`
    };
  });
}
