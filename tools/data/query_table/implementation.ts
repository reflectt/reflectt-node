import {
  type ToolContext,
  validateIdentifier,
  withErrorHandling,
} from '@/lib/tools/helpers';

interface QueryFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startsWith' | 'endsWith' | 'in';
  value: any;
}

interface QueryTableInput {
  table: string;
  where?: QueryFilter[];
  orderBy?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  limit?: number;
  offset?: number;
  target_space?: string;
}

interface QueryTableOutput {
  success: boolean;
  records?: any[];
  count?: number;
  total?: number;
  error?: string;
}

function getNestedValue(obj: any, field: string): any {
  return field.split('.').reduce((acc, part) => acc?.[part], obj);
}

function matchesFilter(record: any, filter: QueryFilter): boolean {
  const value = getNestedValue(record, filter.field);

  switch (filter.operator) {
    case 'eq':
      return value === filter.value;
    case 'ne':
      return value !== filter.value;
    case 'gt':
      return value > filter.value;
    case 'gte':
      return value >= filter.value;
    case 'lt':
      return value < filter.value;
    case 'lte':
      return value <= filter.value;
    case 'contains':
      return typeof value === 'string' && value.includes(filter.value);
    case 'startsWith':
      return typeof value === 'string' && value.startsWith(filter.value);
    case 'endsWith':
      return typeof value === 'string' && value.endsWith(filter.value);
    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(value);
    default:
      return false;
  }
}

export default async function query_table(
  input: QueryTableInput,
  ctx: ToolContext
): Promise<QueryTableOutput> {
  return withErrorHandling(async () => {
    const { table, where, orderBy, limit, offset = 0 } = input;

    // Validate inputs
    validateIdentifier(table, 'table name');

    // ALWAYS use current space context - ignore any target_space parameter
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
    let records = await Promise.all(
      filenames.map(async filename => {
        return await ctx.readJson(spaceTarget, 'tables', table, 'rows', filename);
      })
    );

    // Apply filters
    if (where && where.length > 0) {
      records = records.filter(record =>
        where.every(filter => matchesFilter(record, filter))
      );
    }

    // Apply sorting
    if (orderBy) {
      records.sort((a, b) => {
        const aVal = getNestedValue(a, orderBy.field);
        const bVal = getNestedValue(b, orderBy.field);

        if (aVal === bVal) return 0;

        const comparison = aVal < bVal ? -1 : 1;
        return orderBy.direction === 'asc' ? comparison : -comparison;
      });
    } else {
      // Default sort by created_at desc
      records.sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTime - aTime;
      });
    }

    const total = records.length;

    // Apply pagination
    const startIndex = offset;
    const endIndex = limit ? startIndex + limit : records.length;
    const paginatedRecords = records.slice(startIndex, endIndex);

    return {
      success: true,
      records: paginatedRecords,
      count: paginatedRecords.length,
      total
    };
  });
}
