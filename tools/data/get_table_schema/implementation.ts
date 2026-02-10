import {
  type ToolContext,
  validateIdentifier,
  withErrorHandling,
} from '@/lib/tools/helpers';

interface GetTableSchemaInput {
  table: string;
  target_space?: string;
}

interface GetTableSchemaOutput {
  success: boolean;
  schema?: any;
  path?: string;
  error?: string;
}

export default async function get_table_schema(
  input: GetTableSchemaInput,
  ctx: ToolContext
): Promise<GetTableSchemaOutput> {
  return withErrorHandling(async () => {
    const { table } = input;

    // Validate inputs
    validateIdentifier(table, 'table name');

    // ALWAYS use current space context
    const spaceTarget = undefined;

    // Read and return the schema using ToolContext
    const schema = await ctx.readJson(spaceTarget, 'tables', table, 'schema.json');

    return {
      success: true,
      schema,
      path: `tables/${table}/schema.json`
    };
  });
}
