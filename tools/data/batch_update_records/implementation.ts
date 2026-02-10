import {
  type ToolContext,
  validateIdentifier,
  withErrorHandling,
} from '@/lib/tools/helpers';

interface BatchUpdateRecordsInput {
  table: string;
  updateType: 'uniform' | 'individual';
  uniformUpdate?: {
    updates: Record<string, any>;
    where: {
      column: string;
      operator: 'eq' | 'in' | 'gt' | 'lt' | 'like' | 'neq';
      value: any;
    };
  };
  individualUpdates?: Array<{
    id: string;
    updates: Record<string, any>;
  }>;
  returning?: string[];
  limit?: number;
  target_space?: string;
}

interface BatchUpdateRecordsOutput {
  success: boolean;
  updated: number;
  records?: Record<string, any>[];
  errors?: Array<{ id: string; error: string }>;
  error?: string;
}

/**
 * Batch update records in a table
 *
 * Features:
 * - Uniform updates: Apply same changes to multiple records
 * - Individual updates: Apply different changes per record
 * - Efficient updates with concurrency handling
 * - Optional return of updated records
 * - Automatic updated_at timestamp
 */
export default async function batchUpdateRecords(
  input: BatchUpdateRecordsInput,
  ctx: ToolContext
): Promise<BatchUpdateRecordsOutput> {
  return withErrorHandling(async () => {
    const {
      table,
      updateType,
      uniformUpdate,
      individualUpdates,
      returning = [],
      limit = 10000,
    } = input;

    // Validate table name
    validateIdentifier(table, 'table name');

    // Validate inputs based on updateType
    if (updateType === 'uniform' && !uniformUpdate) {
      throw new Error('uniformUpdate is required when updateType is "uniform"');
    }

    if (updateType === 'individual' && (!individualUpdates || individualUpdates.length === 0)) {
      throw new Error('individualUpdates array is required when updateType is "individual"');
    }

    if (individualUpdates && individualUpdates.length > 1000) {
      throw new Error('Maximum 1000 individual updates per operation');
    }

    // Always use current space context
    const spaceTarget = undefined;

    // Check if table exists
    if (!ctx.fileExists(spaceTarget, 'tables', table, 'rows')) {
      throw new Error(`Table '${table}' does not exist`);
    }

    let updated = 0;
    const updatedRecords: Record<string, any>[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    if (updateType === 'uniform' && uniformUpdate) {
      // Uniform update: Same changes to multiple records
      const { updates, where } = uniformUpdate;
      const files = await ctx.listFiles(spaceTarget, 'tables', table, 'rows');

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        if (updated >= limit) break;

        try {
          const recordData = await ctx.readJson(spaceTarget, 'tables', table, 'rows', file);

          // Check if record matches condition
          if (evaluateCondition(recordData, where)) {
            // Apply updates
            const updatedRecord = {
              ...recordData,
              ...updates,
              updated_at: new Date().toISOString()
            };

            // Write updated record
            await ctx.writeJson(
              spaceTarget,
              'tables',
              table,
              'rows',
              file,
              updatedRecord
            );

            updated++;

            // Add to results if returning is specified
            if (returning.length > 0) {
              const returnData: Record<string, any> = {};
              for (const field of returning) {
                if (updatedRecord[field] !== undefined) {
                  returnData[field] = updatedRecord[field];
                }
              }
              updatedRecords.push(returnData);
            }
          }
        } catch (error) {
          const recordId = file.replace('.json', '');
          errors.push({
            id: recordId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } else if (updateType === 'individual' && individualUpdates) {
      // Individual updates: Different changes per record
      for (const update of individualUpdates) {
        try {
          const { id, updates } = update;
          const file = `${id}.json`;

          // Check if record exists
          if (!ctx.fileExists(spaceTarget, 'tables', table, 'rows', file)) {
            errors.push({
              id,
              error: 'Record not found'
            });
            continue;
          }

          // Load record
          const recordData = await ctx.readJson(spaceTarget, 'tables', table, 'rows', file);

          // Apply updates
          const updatedRecord = {
            ...recordData,
            ...updates,
            updated_at: new Date().toISOString()
          };

          // Write updated record
          await ctx.writeJson(
            spaceTarget,
            'tables',
            table,
            'rows',
            file,
            updatedRecord
          );

          updated++;

          // Add to results if returning is specified
          if (returning.length > 0) {
            const returnData: Record<string, any> = {};
            for (const field of returning) {
              if (updatedRecord[field] !== undefined) {
                returnData[field] = updatedRecord[field];
              }
            }
            updatedRecords.push(returnData);
          }
        } catch (error) {
          errors.push({
            id: update.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    // Trigger event (non-blocking)
    try {
      await ctx.executeTool('trigger_event', {
        event_type: 'data.records_updated',
        space: ctx.currentSpace,
        data: {
          table,
          updated,
          update_type: updateType,
          errors: errors.length,
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'batch_update_records',
          operation: 'batch_update'
        }
      });
    } catch (eventError) {
      console.warn(`Failed to trigger event: ${eventError}`);
    }

    return {
      success: true,
      updated,
      records: returning.length > 0 ? updatedRecords : undefined,
      errors: errors.length > 0 ? errors : undefined
    };
  }) as Promise<BatchUpdateRecordsOutput>;
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
