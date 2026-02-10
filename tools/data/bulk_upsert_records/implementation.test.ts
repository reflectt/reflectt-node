import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import bulkUpsertRecords from './implementation';
import type { ToolContext } from '@/lib/tools/helpers/tool-context';

describe('bulk_upsert_records', () => {
  let tempDir: string;
  let ctx: ToolContext;
  const testTable = 'test_bulk_users';

  beforeEach(() => {
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-upsert-test-'));

    // Create mock ToolContext
    ctx = {
      projectRoot: tempDir,
      currentSpace: 'test',
      resolvePath: (target, ...segments) => {
        return path.join(tempDir, ...segments);
      },
      readJson: async (target, ...segments) => {
        const filePath = path.join(tempDir, ...segments);
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      },
      writeJson: async (target, ...segments) => {
        const filePath = path.join(tempDir, ...segments);
        const data = segments[segments.length - 1];
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      },
      ensureDir: async (target, ...segments) => {
        const dirPath = path.join(tempDir, ...segments);
        fs.mkdirSync(dirPath, { recursive: true });
      },
      fileExists: (target, ...segments) => {
        const filePath = path.join(tempDir, ...segments);
        return fs.existsSync(filePath);
      },
      readdir: async (dirPath) => {
        return fs.readdirSync(dirPath);
      },
      executeTool: async () => ({ success: true })
    } as any;
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should insert multiple new records', async () => {
    const result = await bulkUpsertRecords(
      {
        table: testTable,
        records: [
          { name: 'Alice', email: 'alice@test.com', age: 30 },
          { name: 'Bob', email: 'bob@test.com', age: 25 },
          { name: 'Charlie', email: 'charlie@test.com', age: 35 }
        ]
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.inserted).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should update existing records on conflict', async () => {
    // First insert
    await bulkUpsertRecords(
      {
        table: testTable,
        records: [
          { id: 'user-1', name: 'Alice', email: 'alice@test.com' }
        ]
      },
      ctx
    );

    // Update with conflict
    const result = await bulkUpsertRecords(
      {
        table: testTable,
        records: [
          { id: 'user-1', name: 'Alice Updated', email: 'alice.new@test.com' }
        ],
        conflictColumns: ['id'],
        updateOnConflict: true
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
  });

  it('should process records in batches', async () => {
    const records = Array.from({ length: 150 }, (_, i) => ({
      name: `User ${i}`,
      email: `user${i}@test.com`
    }));

    const result = await bulkUpsertRecords(
      {
        table: testTable,
        records,
        batchSize: 50
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.inserted).toBe(150);
    expect(result.batchesProcessed).toBe(3);
  });

  it('should return inserted records when returnRecords is true', async () => {
    const result = await bulkUpsertRecords(
      {
        table: testTable,
        records: [
          { name: 'Alice', email: 'alice@test.com' },
          { name: 'Bob', email: 'bob@test.com' }
        ],
        returnRecords: true
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.records).toBeDefined();
    expect(result.records).toHaveLength(2);
    expect(result.records?.[0]).toHaveProperty('id');
    expect(result.records?.[0]).toHaveProperty('created_at');
  });

  it('should reject more than 1000 records', async () => {
    const records = Array.from({ length: 1001 }, (_, i) => ({
      name: `User ${i}`
    }));

    const result = await bulkUpsertRecords(
      {
        table: testTable,
        records
      },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Maximum 1000 records');
  });
});
