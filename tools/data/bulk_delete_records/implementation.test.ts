import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import bulkDeleteRecords from './implementation';
import { createTestContext } from '@/lib/tools/helpers/__tests__/test-helpers';

describe('bulk_delete_records', () => {
  let ctx: any;
  const testTable = 'test_delete_users';

  beforeEach(async () => {
    ctx = createTestContext();

    // Setup test table with records
    await ctx.ensureDir(undefined, 'tables', testTable, 'rows');

    // Create test records
    const records = [
      { id: 'user-1', name: 'Alice', status: 'active' },
      { id: 'user-2', name: 'Bob', status: 'inactive' },
      { id: 'user-3', name: 'Charlie', status: 'inactive' },
      { id: 'user-4', name: 'David', status: 'active' },
      { id: 'user-5', name: 'Eve', status: 'pending' }
    ];

    for (const record of records) {
      await ctx.writeJson(undefined, 'tables', testTable, 'rows', `${record.id}.json`, record);
    }
  });

  afterEach(() => {
    const tablePath = ctx.resolvePath(undefined, 'tables', testTable);
    if (fs.existsSync(tablePath)) {
      fs.rmSync(tablePath, { recursive: true, force: true });
    }
  });

  it('should delete records by ID list', async () => {
    const result = await bulkDeleteRecords(
      {
        table: testTable,
        deleteBy: 'ids',
        ids: ['user-1', 'user-2']
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(2);

    // Verify records are deleted
    const user1Path = ctx.resolvePath(undefined, 'tables', testTable, 'rows', 'user-1.json');
    const user3Path = ctx.resolvePath(undefined, 'tables', testTable, 'rows', 'user-3.json');
    expect(fs.existsSync(user1Path)).toBe(false);
    expect(fs.existsSync(user3Path)).toBe(true); // Not deleted
  });

  it('should delete records by condition', async () => {
    const result = await bulkDeleteRecords(
      {
        table: testTable,
        deleteBy: 'condition',
        condition: {
          column: 'status',
          operator: 'eq',
          value: 'inactive'
        }
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(2); // user-2 and user-3
  });

  it('should respect deletion limit', async () => {
    const result = await bulkDeleteRecords(
      {
        table: testTable,
        deleteBy: 'condition',
        condition: {
          column: 'status',
          operator: 'in',
          value: ['active', 'inactive', 'pending']
        },
        limit: 2
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.deleted).toBeLessThanOrEqual(2);
  });

  it('should require confirmation for large deletions', async () => {
    // Add many records
    for (let i = 6; i <= 150; i++) {
      await ctx.writeJson(
        undefined,
        'tables',
        testTable,
        'rows',
        `user-${i}.json`,
        { id: `user-${i}`, name: `User ${i}`, status: 'test' }
      );
    }

    const result = await bulkDeleteRecords(
      {
        table: testTable,
        deleteBy: 'condition',
        condition: {
          column: 'status',
          operator: 'eq',
          value: 'test'
        },
        requireConfirmation: true,
        confirmed: false
      },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.confirmationRequired).toBe(true);
    expect(result.estimatedCount).toBeGreaterThan(100);
  });

  it('should perform soft delete when table has deleted_at column', async () => {
    // Create schema with deleted_at column
    await ctx.writeJson(undefined, 'tables', testTable, 'schema.json', {
      table: testTable,
      fields: {
        id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        deleted_at: { type: 'string', required: false }
      }
    });

    const result = await bulkDeleteRecords(
      {
        table: testTable,
        deleteBy: 'ids',
        ids: ['user-1']
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.softDeleted).toBe(1);

    // Verify record still exists but is marked deleted
    const recordPath = ctx.resolvePath(undefined, 'tables', testTable, 'rows', 'user-1.json');
    expect(fs.existsSync(recordPath)).toBe(true);

    const record = await ctx.readJson(undefined, 'tables', testTable, 'rows', 'user-1.json');
    expect(record.deleted_at).toBeDefined();
  });

  it('should return deleted records when returnDeleted is true', async () => {
    const result = await bulkDeleteRecords(
      {
        table: testTable,
        deleteBy: 'ids',
        ids: ['user-1', 'user-2'],
        returnDeleted: true
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.records).toBeDefined();
    expect(result.records).toHaveLength(2);
  });

  it('should handle gt operator in conditions', async () => {
    // Add records with created_at timestamps
    await ctx.writeJson(
      undefined,
      'tables',
      testTable,
      'rows',
      'user-6.json',
      { id: 'user-6', name: 'Old User', created_at: '2020-01-01' }
    );

    const result = await bulkDeleteRecords(
      {
        table: testTable,
        deleteBy: 'condition',
        condition: {
          column: 'created_at',
          operator: 'lt',
          value: '2021-01-01'
        }
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(1);
  });

  it('should handle like operator for pattern matching', async () => {
    const result = await bulkDeleteRecords(
      {
        table: testTable,
        deleteBy: 'condition',
        condition: {
          column: 'name',
          operator: 'like',
          value: 'bob'
        }
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(1); // Matches Bob (case-insensitive)
  });

  it('should reject deletion limit over 10,000', async () => {
    const result = await bulkDeleteRecords(
      {
        table: testTable,
        deleteBy: 'ids',
        ids: ['user-1'],
        limit: 15000
      },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Maximum deletion limit');
  });
});
