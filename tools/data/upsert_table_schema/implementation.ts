import {
  type ToolContext,
  validateIdentifier,
  withErrorHandling,
} from '@/lib/tools/helpers';

interface UpdateTableSchemaInput {
  table: string;
  schema: {
    table_name: string;
    fields: Record<string, {
      type: string;
      required?: boolean;
      description?: string;
    }>;
    indexes?: string[];
    created_at?: string;
    updated_at?: string;
  };
  target_space?: string;
}

interface UpdateTableSchemaOutput {
  success: boolean;
  schema?: any;
  path?: string;
  error?: string;
}

export default async function update_table_schema(
  input: UpdateTableSchemaInput,
  ctx: ToolContext
): Promise<UpdateTableSchemaOutput> {
  return withErrorHandling(async () => {
    const { table, schema } = input;

    // Validate table name
    validateIdentifier(table, 'table name');

    // ALWAYS use current space context
    const spaceTarget = undefined;

    // Validate schema structure
    if (!schema || typeof schema !== 'object') {
      throw new Error('Schema must be an object.');
    }

    if (!schema.fields || typeof schema.fields !== 'object') {
      throw new Error('Schema must include a "fields" object.');
    }

    // Ensure table_name matches
    if (schema.table_name && schema.table_name !== table) {
      throw new Error(`Schema table_name "${schema.table_name}" does not match table "${table}".`);
    }

    // Ensure table directory exists using ToolContext
    await ctx.ensureDir(spaceTarget, 'tables', table);

    // Check if schema already exists and read it
    let existingSchema: any = null;
    if (ctx.fileExists(spaceTarget, 'tables', table, 'schema.json')) {
      existingSchema = await ctx.readJson(spaceTarget, 'tables', table, 'schema.json');
    }

    // Build the updated schema
    const updatedSchema = {
      table_name: table,
      ...schema,
      created_at: existingSchema?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Write the schema using ToolContext
    await ctx.writeJson(spaceTarget, 'tables', table, 'schema.json', updatedSchema);

    // Ensure rows directory exists
    await ctx.ensureDir(spaceTarget, 'tables', table, 'rows');

    return {
      success: true,
      schema: updatedSchema,
      path: `tables/${table}/schema.json`
    };
  });
}
