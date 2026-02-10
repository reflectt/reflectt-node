import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import batchUpdateRecords from './implementation';
import { createTestContext } from '@/lib/tools/helpers/__tests__/test-helpers';

describe('batch_update_records', () => {
  let ctx: any;
  const testTable = 'test_update_users';

  beforeEach(async () => {
    ctx = createTestContext();

    // Setup test table with records
    await ctx.ensureDir(undefined, 'tables', testTable, 'rows');

    // Create test records
    const records = [
      { id: 'user-1', name: 'Alice', status: 'pending', score: 10 },
      { id: 'user-2', name: 'Bob', status: 'pending', score: 20 },
      { id: 'user-3', name: 'Charlie', status: 'active', score: 30 },
      { id: 'user-4', name: 'David', status: 'pending', score: 15 }
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

  it('should perform uniform update on matching records', async () => {
    const result = await batchUpdateRecords(
      {
        table: testTable,
        updateType: 'uniform',
        uniformUpdate: {
          updates: {
            status: 'active',
            verified: true
          },
          where: {
            column: 'status',
            operator: 'eq',
            value: 'pending'
          }
        }
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.updated).toBe(3); // user-1, user-2, user-4

    // Verify updates
    const user1 = await ctx.readJson(undefined, 'tables', testTable, 'rows', 'user-1.json');
    expect(user1.status).toBe('active');
    expect(user1.verified).toBe(true);
    expect(user1.updated_at).toBeDefined();
  });

  it('should perform individual updates with different values', async () => {
    const result = await batchUpdateRecords(
      {
        table: testTable,
        updateType: 'individual',
        individualUpdates: [
          { id: 'user-1', updates: { score: 100 } },
          { id: 'user-2', updates: { score: 200, status: 'premium' } }
        ]
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.updated).toBe(2);

    // Verify individual updates
    const user1 = await ctx.readJson(undefined, 'tables', testTable, 'rows', 'user-1.json');
    const user2 = await ctx.readJson(undefined, 'tables', testTable, 'rows', 'user-2.json');

    expect(user1.score).toBe(100);
    expect(user2.score).toBe(200);
    expect(user2.status).toBe('premium');
  });

  it('should return specified columns when returning is set', async () => {
    const result = await batchUpdateRecords(
      {
        table: testTable,
        updateType: 'uniform',
        uniformUpdate: {
          updates: { score: 50 },
          where: { column: 'status', operator: 'eq', value: 'pending' }
        },
        returning: ['id', 'name', 'score']
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.records).toBeDefined();
    expect(result.records).toHaveLength(3);
    expect(result.records?.[0]).toHaveProperty('id');
    expect(result.records?.[0]).toHaveProperty('name');
    expect(result.records?.[0]).toHaveProperty('score');
    expect(result.records?.[0]).not.toHaveProperty('status');
  });

  it('should respect limit for uniform updates', async () => {
    const result = await batchUpdateRecords(
      {
        table: testTable,
        updateType: 'uniform',
        uniformUpdate: {
          updates: { status: 'processed' },
          where: { column: 'status', operator: 'eq', value: 'pending' }
        },
        limit: 2
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.updated).toBe(2);
  });

  it('should handle non-existent records in individual updates', async () => {
    const result = await batchUpdateRecords(
      {
        table: testTable,
        updateType: 'individual',
        individualUpdates: [
          { id: 'user-1', updates: { score: 100 } },
          { id: 'user-999', updates: { score: 999 } } // Doesn't exist
        ]
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);
    expect(result.errors).toBeDefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0].id).toBe('user-999');
    expect(result.errors?.[0].error).toContain('not found');
  });

  it('should handle gt operator in conditions', async () => {
    const result = await batchUpdateRecords(
      {
        table: testTable,
        updateType: 'uniform',
        uniformUpdate: {
          updates: { level: 'high' },
          where: { column: 'score', operator: 'gt', value: 15 }
        }
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.updated).toBe(2); // user-2 (20) and user-3 (30)
  });

  it('should handle in operator for multiple values', async () => {
    const result = await batchUpdateRecords(
      {
        table: testTable,
        updateType: 'uniform',
        uniformUpdate: {
          updates: { tagged: true },
          where: {
            column: 'status',
            operator: 'in',
            value: ['pending', 'active']
          }
        }
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.updated).toBe(4); // All records
  });

  it('should automatically add updated_at timestamp', async () => {
    const beforeUpdate = new Date().toISOString();

    await batchUpdateRecords(
      {
        table: testTable,
        updateType: 'individual',
        individualUpdates: [{ id: 'user-1', updates: { name: 'Alice Updated' } }],
        returning: ['updated_at']
      },
      ctx
    );

    const user1 = await ctx.readJson(undefined, 'tables', testTable, 'rows', 'user-1.json');
    expect(user1.updated_at).toBeDefined();
    expect(user1.updated_at).toBeGreaterThanOrEqual(beforeUpdate);
  });

  it('should reject more than 1000 individual updates', async () => {
    const updates = Array.from({ length: 1001 }, (_, i) => ({
      id: `user-${i}`,
      updates: { status: 'updated' }
    }));

    const result = await batchUpdateRecords(
      {
        table: testTable,
        updateType: 'individual',
        individualUpdates: updates
      },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Maximum 1000');
  });

  it('should handle like operator for pattern matching', async () => {
    const result = await batchUpdateRecords(
      {
        table: testTable,
        updateType: 'uniform',
        uniformUpdate: {
          updates: { flagged: true },
          where: { column: 'name', operator: 'like', value: 'li' }
        }
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.updated).toBe(2); // Alice and Charlie
  });
});
