import { randomUUID } from 'crypto';
import {
  type ToolContext,
  validateIdentifier,
} from '@/lib/tools/helpers';

interface SaveRecordInput {
  table: string;  // e.g., 'stories', 'characters', 'worlds'
  record: Record<string, any>;  // The data to save
  target_space?: string;  // Optional: save to specific space
}

interface SaveRecordOutput {
  success: boolean;
  id?: string;  // Generated or provided record ID
  path?: string;  // Path to saved record file
  schema_path?: string;  // Path to schema file (if created)
  error?: string;
}

/**
 * Save a structured record to a table in a space
 *
 * Enforces database-like structure:
 * - tables/[table-name]/schema.json  (auto-generated if missing)
 * - tables/[table-name]/rows/[row-id].json
 *
 * Examples:
 * - tables/stories/rows/uuid-123.json
 * - tables/characters/rows/uuid-456.json
 * - tables/worlds/rows/uuid-789.json
 *
 * This mimics PostgreSQL table structure and keeps data organized.
 *
 * Auto-generates schema.json based on first record's fields.
 */
export default async function upsertRecord(
  input: SaveRecordInput,
  ctx: ToolContext
): Promise<SaveRecordOutput> {
  try {
    const { table, record } = input;

    // Validate table name
    validateIdentifier(table, 'table name');

    // ALWAYS use current space context - ignore any target_space parameter
    // Space-specific agents should only access their own space
    const spaceTarget = undefined;

    // Ensure record has an ID
    const id = record.id || randomUUID();
    const recordWithId: Record<string, any> = { ...record, id };

    // Add timestamps if not present
    const now = new Date().toISOString();
    recordWithId.created_at = recordWithId.created_at || now;
    recordWithId.updated_at = recordWithId.updated_at || now;

    // Ensure directories exist using ToolContext
    await ctx.ensureDir(spaceTarget, 'tables', table, 'rows');

    // Auto-generate schema if it doesn't exist
    let schemaCreated = false;
    if (!await ctx.fileExists(spaceTarget, 'tables', table, 'schema.json')) {
      const schema = generateSchemaFromRecord(table, recordWithId);
      await ctx.writeJson(spaceTarget, 'tables', table, 'schema.json', schema);
      schemaCreated = true;
    }

    // Determine if this is create or update
    const isUpdate = await ctx.fileExists(spaceTarget, 'tables', table, 'rows', `${id}.json`);
    const operation = isUpdate ? 'updated' : 'created';

    // Save record using ToolContext
    await ctx.writeJson(spaceTarget, 'tables', table, 'rows', `${id}.json`, recordWithId);

    // Trigger event (truly non-blocking - fire and forget)
    // PERFORMANCE FIX: Don't await the event trigger to avoid 7-8s file I/O blocking
    ctx.executeTool('trigger_event', {
      event_type: isUpdate ? 'data.record_updated' : 'data.record_created',
      space: ctx.currentSpace,
      data: {
        table,
        record_id: id,
        operation,
        record: recordWithId,
        schema_created: schemaCreated,
        timestamp: new Date().toISOString()
      },
      metadata: {
        source_tool: 'upsert_record',
        operation: `record_${operation}`
      }
    }).catch(eventError => {
      console.warn(`Failed to trigger event: ${eventError}`);
    });

    return {
      success: true,
      id,
      path: `tables/${table}/rows/${id}.json`,
      schema_path: schemaCreated ? `tables/${table}/schema.json` : undefined
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Generate a basic schema from a record's fields
 */
function generateSchemaFromRecord(tableName: string, record: Record<string, any>) {
  const fields: Record<string, any> = {};

  for (const [key, value] of Object.entries(record)) {
    let type: string = typeof value;

    // Handle special cases
    if (value === null) {
      type = 'string';  // Default nullable to string
    } else if (Array.isArray(value)) {
      type = 'array';
    } else if (value && typeof value === 'object') {
      type = 'object';
    }

    fields[key] = {
      type,
      required: key === 'id' || key === 'created_at' || key === 'updated_at',
      description: `${key} field`
    };
  }

  return {
    table: tableName,
    version: 1,
    created_at: new Date().toISOString(),
    fields,
    indexes: ['id'],  // Default index on id
    description: `Auto-generated schema for ${tableName} table`
  };
}
