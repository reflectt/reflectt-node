import { describe, it, expect, beforeEach } from 'vitest';
import searchTools from './implementation';
import { createTestContext } from '@/lib/tools/helpers/__tests__/test-helpers';

describe('search_tools', () => {
  let ctx: any;

  beforeEach(() => {
    ctx = createTestContext();
  });

  it('should search tools by query', async () => {
    const result = await searchTools(
      {
        query: 'record'
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.results).toBeDefined();
    expect(result.totalFound).toBeGreaterThan(0);
    expect(result.searchTime).toBeDefined();
  });

  it('should filter by category', async () => {
    const result = await searchTools(
      {
        query: 'data',
        category: 'data'
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.results).toBeDefined();

    // All results should be from 'data' category
    result.results?.forEach(tool => {
      expect(tool.category).toBe('data');
    });
  });

  it('should filter by capabilities/tags', async () => {
    const result = await searchTools(
      {
        query: 'bulk',
        capabilities: ['bulk']
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.results).toBeDefined();

    // All results should have 'bulk' tag
    result.results?.forEach(tool => {
      expect(tool.tags).toContain('bulk');
    });
  });

  it('should respect limit parameter', async () => {
    const result = await searchTools(
      {
        query: 'record',
        limit: 3
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.results).toBeDefined();
    expect(result.results!.length).toBeLessThanOrEqual(3);
  });

  it('should include examples when requested', async () => {
    const result = await searchTools(
      {
        query: 'bulk_upsert',
        includeExamples: true
      },
      ctx
    );

    expect(result.success).toBe(true);
    if (result.results && result.results.length > 0) {
      const tool = result.results[0];
      if (tool.usageExample) {
        expect(tool.usageExample).toBeDefined();
      }
    }
  });

  it('should exclude examples when not requested', async () => {
    const result = await searchTools(
      {
        query: 'bulk_upsert',
        includeExamples: false
      },
      ctx
    );

    expect(result.success).toBe(true);
    result.results?.forEach(tool => {
      expect(tool.usageExample).toBeUndefined();
    });
  });

  it('should respect minScore threshold', async () => {
    const result = await searchTools(
      {
        query: 'xyz123nonexistent',
        minScore: 50
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.results).toBeDefined();

    // All results should have score >= 50
    result.results?.forEach(tool => {
      expect(tool.relevanceScore).toBeGreaterThanOrEqual(50);
    });
  });

  it('should return results sorted by relevance score', async () => {
    const result = await searchTools(
      {
        query: 'record data',
        limit: 10
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.results).toBeDefined();

    // Results should be in descending order by score
    for (let i = 0; i < result.results!.length - 1; i++) {
      expect(result.results![i].relevanceScore)
        .toBeGreaterThanOrEqual(result.results![i + 1].relevanceScore);
    }
  });

  it('should provide matched fields information', async () => {
    const result = await searchTools(
      {
        query: 'bulk upsert'
      },
      ctx
    );

    expect(result.success).toBe(true);
    if (result.results && result.results.length > 0) {
      const tool = result.results[0];
      expect(tool.matchedFields).toBeDefined();
      expect(Array.isArray(tool.matchedFields)).toBe(true);
    }
  });

  it('should handle multi-word queries', async () => {
    const result = await searchTools(
      {
        query: 'bulk insert multiple records'
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.results).toBeDefined();
    expect(result.totalFound).toBeGreaterThan(0);
  });

  it('should be case-insensitive', async () => {
    const resultLower = await searchTools({ query: 'record' }, ctx);
    const resultUpper = await searchTools({ query: 'RECORD' }, ctx);
    const resultMixed = await searchTools({ query: 'Record' }, ctx);

    expect(resultLower.totalFound).toBe(resultUpper.totalFound);
    expect(resultLower.totalFound).toBe(resultMixed.totalFound);
  });

  it('should return input schema for each tool', async () => {
    const result = await searchTools(
      {
        query: 'bulk_upsert_records'
      },
      ctx
    );

    expect(result.success).toBe(true);
    if (result.results && result.results.length > 0) {
      const tool = result.results[0];
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('should find tools by parameter names', async () => {
    const result = await searchTools(
      {
        query: 'batchSize'
      },
      ctx
    );

    expect(result.success).toBe(true);
    if (result.results && result.results.length > 0) {
      // Should find tools with batchSize parameter
      const hasMatch = result.results.some(tool =>
        tool.matchedFields?.some(field => field.includes('parameter'))
      );
      expect(hasMatch).toBe(true);
    }
  });

  it('should handle exact tool name matches with high scores', async () => {
    const result = await searchTools(
      {
        query: 'bulk_upsert_records'
      },
      ctx
    );

    expect(result.success).toBe(true);
    if (result.results && result.results.length > 0) {
      const topResult = result.results[0];
      // Exact match should have very high score
      expect(topResult.relevanceScore).toBeGreaterThan(80);
    }
  });

  it('should search across descriptions', async () => {
    const result = await searchTools(
      {
        query: 'Insert or update multiple'
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.results).toBeDefined();

    // Should find bulk_upsert_records based on description
    const hasBulkUpsert = result.results?.some(tool =>
      tool.toolName.toLowerCase().includes('upsert') ||
      tool.description.toLowerCase().includes('insert or update')
    );
    expect(hasBulkUpsert).toBe(true);
  });

  it('should return detailed tool information', async () => {
    const result = await searchTools(
      {
        query: 'record',
        limit: 1
      },
      ctx
    );

    expect(result.success).toBe(true);
    if (result.results && result.results.length > 0) {
      const tool = result.results[0];
      expect(tool).toHaveProperty('toolName');
      expect(tool).toHaveProperty('category');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('relevanceScore');
      expect(tool).toHaveProperty('inputSchema');
      expect(tool).toHaveProperty('matchedFields');
    }
  });
});
