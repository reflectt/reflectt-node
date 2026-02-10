import {
  type ToolContext,
  validateIdentifier,
  withErrorHandling,
} from '@/lib/tools/helpers';

interface BulkDeleteRecordsInput {
  table: string;
  deleteBy: 'ids' | 'condition';
  ids?: string[];
  condition?: {
    column: string;
    operator: 'eq' | 'in' | 'gt' | 'lt' | 'like' | 'neq';
    value: any;
  };
  limit?: number;
  softDelete?: boolean;
  requireConfirmation?: boolean;
  confirmed?: boolean;
  returnDeleted?: boolean;
  target_space?: string;
}

interface BulkDeleteRecordsOutput {
  success: boolean;
  deleted: number;
  softDeleted?: number;
  records?: Record<string, any>[];
  confirmationRequired?: boolean;
  estimatedCount?: number;
  error?: string;
}

/**
 * Bulk delete records from a table
 *
 * Features:
 * - Delete by ID list or conditions
 * - Safety limits (max 10,000 records)
 * - Confirmation requirement for large deletions
 * - Soft delete support (marks records as deleted instead of removing)
 * - Audit trail logging
 * - Returns deleted records if requested
 */
export default async function bulkDeleteRecords(
  input: BulkDeleteRecordsInput,
  ctx: ToolContext
): Promise<BulkDeleteRecordsOutput> {
  return withErrorHandling<BulkDeleteRecordsOutput>(async () => {
    const {
      table,
      deleteBy,
      ids,
      condition,
      limit = 10000,
      softDelete,
      requireConfirmation = true,
      confirmed = false,
      returnDeleted = false,
    } = input;

    // Validate table name
    validateIdentifier(table, 'table name');

    // Validate inputs based on deleteBy
    if (deleteBy === 'ids' && (!ids || ids.length === 0)) {
      throw new Error('ids array is required when deleteBy is "ids"');
    }

    if (deleteBy === 'condition' && !condition) {
      throw new Error('condition object is required when deleteBy is "condition"');
    }

    if (limit > 10000) {
      throw new Error('Maximum deletion limit is 10,000 records per operation');
    }

    // Always use current space context
    const spaceTarget = undefined;

    // Check if table exists
    if (!ctx.fileExists(spaceTarget, 'tables', table, 'rows')) {
      throw new Error(`Table '${table}' does not exist`);
    }

    // Load schema to check for deleted_at column
    let schema: any = null;
    let hasSoftDeleteColumn = false;

    if (ctx.fileExists(spaceTarget, 'tables', table, 'schema.json')) {
      schema = await ctx.readJson(spaceTarget, 'tables', table, 'schema.json');
      hasSoftDeleteColumn = schema?.fields?.deleted_at !== undefined;
    }

    // Determine if we should soft delete
    const shouldSoftDelete = softDelete !== undefined ? softDelete : hasSoftDeleteColumn;

    // Find records to delete
    const files = await ctx.listFiles(spaceTarget, 'tables', table, 'rows');
    const recordsToDelete: Array<{ id: string; file: string; data: Record<string, any> }> = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const recordData = await ctx.readJson(spaceTarget, 'tables', table, 'rows', file);

      // Skip already soft-deleted records
      if (shouldSoftDelete && recordData.deleted_at) {
        continue;
      }

      let shouldDelete = false;

      if (deleteBy === 'ids') {
        shouldDelete = ids!.includes(recordData.id);
      } else if (deleteBy === 'condition' && condition) {
        shouldDelete = evaluateCondition(recordData, condition);
      }

      if (shouldDelete) {
        recordsToDelete.push({
          id: recordData.id,
          file,
          data: recordData
        });

        // Stop if we've reached the limit
        if (recordsToDelete.length >= limit) {
          break;
        }
      }
    }

    // Check if confirmation is required
    if (requireConfirmation && recordsToDelete.length > 100 && !confirmed) {
      return {
        success: false,
        deleted: 0,
        confirmationRequired: true,
        estimatedCount: recordsToDelete.length,
        error: `This operation will delete ${recordsToDelete.length} records. Please set 'confirmed: true' to proceed.`
      };
    }

    // Perform deletion
    let deleted = 0;
    let softDeleted = 0;
    const deletedRecords: Record<string, any>[] = [];

    for (const record of recordsToDelete) {
      try {
        if (shouldSoftDelete) {
          // Soft delete: Update deleted_at timestamp
          const updatedRecord = {
            ...record.data,
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          await ctx.writeJson(
            spaceTarget,
            'tables',
            table,
            'rows',
            record.file,
            updatedRecord
          );

          softDeleted++;
          if (returnDeleted) deletedRecords.push(updatedRecord);
        } else {
          // Hard delete: Remove file
          await ctx.deleteFile(spaceTarget, 'tables', table, 'rows', record.file);

          deleted++;
          if (returnDeleted) deletedRecords.push(record.data);
        }
      } catch (error) {
        console.error(`Failed to delete record ${record.id}:`, error);
      }
    }

    // Trigger event (non-blocking)
    try {
      await ctx.executeTool('trigger_event', {
        event_type: shouldSoftDelete ? 'data.records_soft_deleted' : 'data.records_deleted',
        space: ctx.currentSpace,
        data: {
          table,
          deleted: shouldSoftDelete ? softDeleted : deleted,
          soft_delete: shouldSoftDelete,
          delete_by: deleteBy,
          condition: deleteBy === 'condition' ? condition : undefined,
          ids_count: deleteBy === 'ids' ? ids?.length : undefined,
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'bulk_delete_records',
          operation: shouldSoftDelete ? 'soft_delete' : 'hard_delete'
        }
      });
    } catch (eventError) {
      console.warn(`Failed to trigger event: ${eventError}`);
    }

    return {
      success: true,
      deleted: shouldSoftDelete ? 0 : deleted,
      softDeleted: shouldSoftDelete ? softDeleted : undefined,
      records: returnDeleted ? deletedRecords : undefined
    };
  }) as Promise<BulkDeleteRecordsOutput>;
}

/**
 * Evaluate a condition against a record
 */
function evaluateCondition(
  record: Record<string, any>,
  condition: { column: string; operator: string; value: any }
): boolean {
  const { column, operator, value } = condition;
  const recordValue = record[column];

  switch (operator) {
    case 'eq':
      return recordValue === value;
    case 'neq':
      return recordValue !== value;
    case 'gt':
      return recordValue > value;
    case 'lt':
      return recordValue < value;
    case 'in':
      return Array.isArray(value) && value.includes(recordValue);
    case 'like':
      return String(recordValue).toLowerCase().includes(String(value).toLowerCase());
    default:
      return false;
  }
}
