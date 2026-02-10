import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import applyRule from './implementation';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('apply_rule', () => {
  const testDataDir = path.join(__dirname, '../../../../test-data');
  const testGlobalDir = path.join(testDataDir, 'global');
  const testRulesDir = path.join(testGlobalDir, 'rules');

  beforeAll(async () => {
    // Create test directories
    await fs.mkdir(testRulesDir, { recursive: true });
  });

  afterAll(async () => {
    // Clean up test data
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  describe('String Operators', () => {
    beforeEach(async () => {
      // Create a test rule with string conditions
      const ruleId = 'string-validation';
      const ruleDir = path.join(testRulesDir, ruleId);
      await fs.mkdir(ruleDir, { recursive: true });

      const definition = {
        id: ruleId,
        name: 'String Validation Rule',
        description: 'Tests string operators',
        version: '1.0.0',
        type: 'validation',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        author: 'test',
        input_schema: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string' }
          }
        },
        output_schema: {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            errors: { type: 'array' }
          }
        },
        conditions: [],
        actions: [],
        dependencies: [],
        tags: ['test'],
        metadata: {}
      };

      const metadata = {
        version_history: [],
        usage_stats: {
          total_executions: 0,
          success_count: 0,
          failure_count: 0,
          avg_execution_time_ms: 0
        }
      };

      await fs.writeFile(
        path.join(ruleDir, 'definition.json'),
        JSON.stringify(definition, null, 2)
      );
      await fs.writeFile(
        path.join(ruleDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );
      await fs.writeFile(
        path.join(ruleDir, 'prompt.md'),
        '# String Validation Rule\nTest rule for string operators'
      );
    });

    afterEach(async () => {
      await fs.rm(path.join(testRulesDir, 'string-validation'), { recursive: true, force: true });
    });

    test('contains operator - should pass when substring exists', async () => {
      // Update rule with contains condition
      const ruleDir = path.join(testRulesDir, 'string-validation');
      const definitionPath = path.join(ruleDir, 'definition.json');
      const definition = JSON.parse(await fs.readFile(definitionPath, 'utf-8'));
      definition.conditions = [
        { field: 'text', operator: 'contains', value: 'hello' }
      ];
      await fs.writeFile(definitionPath, JSON.stringify(definition, null, 2));

      const result = await applyRule(
        {
          rule_id: 'string-validation',
          input: { text: 'hello world' },
          log_execution: false
        },
        testDataDir,
        testGlobalDir
      );

      expect(result.success).toBe(true);
      expect(result.result.valid).toBe(true);
      expect(result.result.errors).toHaveLength(0);
    });

    test('contains operator - should fail when substring does not exist', async () => {
      const ruleDir = path.join(testRulesDir, 'string-validation');
      const definitionPath = path.join(ruleDir, 'definition.json');
      const definition = JSON.parse(await fs.readFile(definitionPath, 'utf-8'));
      definition.conditions = [
        { field: 'text', operator: 'contains', value: 'goodbye' }
      ];
      await fs.writeFile(definitionPath, JSON.stringify(definition, null, 2));

      const result = await applyRule(
        {
          rule_id: 'string-validation',
          input: { text: 'hello world' },
          log_execution: false
        },
        testDataDir,
        testGlobalDir
      );

      expect(result.success).toBe(true);
      expect(result.result.valid).toBe(false);
      expect(result.result.errors.length).toBeGreaterThan(0);
    });

    test('startsWith operator - should pass when string starts with value', async () => {
      const ruleDir = path.join(testRulesDir, 'string-validation');
      const definitionPath = path.join(ruleDir, 'definition.json');
      const definition = JSON.parse(await fs.readFile(definitionPath, 'utf-8'));
      definition.conditions = [
        { field: 'text', operator: 'startsWith', value: 'hello' }
      ];
      await fs.writeFile(definitionPath, JSON.stringify(definition, null, 2));

      const result = await applyRule(
        {
          rule_id: 'string-validation',
          input: { text: 'hello world' },
          log_execution: false
        },
        testDataDir,
        testGlobalDir
      );

      expect(result.success).toBe(true);
      expect(result.result.valid).toBe(true);
      expect(result.result.errors).toHaveLength(0);
    });

    test('startsWith operator - should fail when string does not start with value', async () => {
      const ruleDir = path.join(testRulesDir, 'string-validation');
      const definitionPath = path.join(ruleDir, 'definition.json');
      const definition = JSON.parse(await fs.readFile(definitionPath, 'utf-8'));
      definition.conditions = [
        { field: 'text', operator: 'startsWith', value: 'world' }
      ];
      await fs.writeFile(definitionPath, JSON.stringify(definition, null, 2));

      const result = await applyRule(
        {
          rule_id: 'string-validation',
          input: { text: 'hello world' },
          log_execution: false
        },
        testDataDir,
        testGlobalDir
      );

      expect(result.success).toBe(true);
      expect(result.result.valid).toBe(false);
      expect(result.result.errors.length).toBeGreaterThan(0);
    });

    test('endsWith operator - should pass when string ends with value', async () => {
      const ruleDir = path.join(testRulesDir, 'string-validation');
      const definitionPath = path.join(ruleDir, 'definition.json');
      const definition = JSON.parse(await fs.readFile(definitionPath, 'utf-8'));
      definition.conditions = [
        { field: 'text', operator: 'endsWith', value: 'world' }
      ];
      await fs.writeFile(definitionPath, JSON.stringify(definition, null, 2));

      const result = await applyRule(
        {
          rule_id: 'string-validation',
          input: { text: 'hello world' },
          log_execution: false
        },
        testDataDir,
        testGlobalDir
      );

      expect(result.success).toBe(true);
      expect(result.result.valid).toBe(true);
      expect(result.result.errors).toHaveLength(0);
    });

    test('endsWith operator - should fail when string does not end with value', async () => {
      const ruleDir = path.join(testRulesDir, 'string-validation');
      const definitionPath = path.join(ruleDir, 'definition.json');
      const definition = JSON.parse(await fs.readFile(definitionPath, 'utf-8'));
      definition.conditions = [
        { field: 'text', operator: 'endsWith', value: 'hello' }
      ];
      await fs.writeFile(definitionPath, JSON.stringify(definition, null, 2));

      const result = await applyRule(
        {
          rule_id: 'string-validation',
          input: { text: 'hello world' },
          log_execution: false
        },
        testDataDir,
        testGlobalDir
      );

      expect(result.success).toBe(true);
      expect(result.result.valid).toBe(false);
      expect(result.result.errors.length).toBeGreaterThan(0);
    });

    test('matches operator - should pass when regex matches', async () => {
      const ruleDir = path.join(testRulesDir, 'string-validation');
      const definitionPath = path.join(ruleDir, 'definition.json');
      const definition = JSON.parse(await fs.readFile(definitionPath, 'utf-8'));
      definition.conditions = [
        { field: 'text', operator: 'matches', value: '^hello.*world$' }
      ];
      await fs.writeFile(definitionPath, JSON.stringify(definition, null, 2));

      const result = await applyRule(
        {
          rule_id: 'string-validation',
          input: { text: 'hello beautiful world' },
          log_execution: false
        },
        testDataDir,
        testGlobalDir
      );

      expect(result.success).toBe(true);
      expect(result.result.valid).toBe(true);
      expect(result.result.errors).toHaveLength(0);
    });

    test('matches operator - should fail when regex does not match', async () => {
      const ruleDir = path.join(testRulesDir, 'string-validation');
      const definitionPath = path.join(ruleDir, 'definition.json');
      const definition = JSON.parse(await fs.readFile(definitionPath, 'utf-8'));
      definition.conditions = [
        { field: 'text', operator: 'matches', value: '^goodbye' }
      ];
      await fs.writeFile(definitionPath, JSON.stringify(definition, null, 2));

      const result = await applyRule(
        {
          rule_id: 'string-validation',
          input: { text: 'hello world' },
          log_execution: false
        },
        testDataDir,
        testGlobalDir
      );

      expect(result.success).toBe(true);
      expect(result.result.valid).toBe(false);
      expect(result.result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Backward Compatibility', () => {
    test('existing operators should still work', async () => {
      const ruleId = 'backward-compat';
      const ruleDir = path.join(testRulesDir, ruleId);
      await fs.mkdir(ruleDir, { recursive: true });

      const definition = {
        id: ruleId,
        name: 'Backward Compatibility Test',
        description: 'Tests existing operators',
        version: '1.0.0',
        type: 'validation',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        author: 'test',
        input_schema: {
          type: 'object',
          required: ['value', 'status'],
          properties: {
            value: { type: 'number' },
            status: { type: 'string' }
          }
        },
        output_schema: {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            errors: { type: 'array' }
          }
        },
        conditions: [
          { field: 'value', operator: 'gt', value: 10 },
          { field: 'value', operator: 'lte', value: 100 },
          { field: 'status', operator: 'eq', value: 'active' }
        ],
        actions: [],
        dependencies: [],
        tags: ['test'],
        metadata: {}
      };

      const metadata = {
        version_history: [],
        usage_stats: {
          total_executions: 0,
          success_count: 0,
          failure_count: 0,
          avg_execution_time_ms: 0
        }
      };

      await fs.writeFile(
        path.join(ruleDir, 'definition.json'),
        JSON.stringify(definition, null, 2)
      );
      await fs.writeFile(
        path.join(ruleDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );
      await fs.writeFile(
        path.join(ruleDir, 'prompt.md'),
        '# Backward Compatibility Test'
      );

      const result = await applyRule(
        {
          rule_id: ruleId,
          input: { value: 50, status: 'active' },
          log_execution: false
        },
        testDataDir,
        testGlobalDir
      );

      expect(result.success).toBe(true);
      expect(result.result.valid).toBe(true);
      expect(result.result.errors).toHaveLength(0);

      // Clean up
      await fs.rm(ruleDir, { recursive: true, force: true });
    });
  });

  describe('Error Handling', () => {
    test('should return error for unknown operator', async () => {
      const ruleId = 'unknown-operator';
      const ruleDir = path.join(testRulesDir, ruleId);
      await fs.mkdir(ruleDir, { recursive: true });

      const definition = {
        id: ruleId,
        name: 'Unknown Operator Test',
        description: 'Tests unknown operator handling',
        version: '1.0.0',
        type: 'validation',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        author: 'test',
        input_schema: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string' }
          }
        },
        output_schema: {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            errors: { type: 'array' }
          }
        },
        conditions: [
          { field: 'text', operator: 'invalidOperator', value: 'test' }
        ],
        actions: [],
        dependencies: [],
        tags: ['test'],
        metadata: {}
      };

      const metadata = {
        version_history: [],
        usage_stats: {
          total_executions: 0,
          success_count: 0,
          failure_count: 0,
          avg_execution_time_ms: 0
        }
      };

      await fs.writeFile(
        path.join(ruleDir, 'definition.json'),
        JSON.stringify(definition, null, 2)
      );
      await fs.writeFile(
        path.join(ruleDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );
      await fs.writeFile(
        path.join(ruleDir, 'prompt.md'),
        '# Unknown Operator Test'
      );

      const result = await applyRule(
        {
          rule_id: ruleId,
          input: { text: 'test value' },
          log_execution: false
        },
        testDataDir,
        testGlobalDir
      );

      expect(result.success).toBe(true);
      expect(result.result.valid).toBe(false);
      expect(result.result.errors).toContain('Unknown operator: invalidOperator');

      // Clean up
      await fs.rm(ruleDir, { recursive: true, force: true });
    });
  });
});