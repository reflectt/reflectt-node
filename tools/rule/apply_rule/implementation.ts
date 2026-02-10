import { type ToolContext } from '@/lib/tools/helpers';

interface ApplyRuleInput {
  rule_id: string;
  input: Record<string, any>;
  context?: Record<string, any>;
  dry_run?: boolean;
  log_execution?: boolean;
}

interface ApplyRuleOutput {
  success: boolean;
  result?: any;
  errors?: string[];
  execution_time_ms?: number;
  rules_applied?: string[];
  error?: string;
}

/**
 * Execute a rule with given input
 */
export default async function applyRule(
  input: ApplyRuleInput,
  ctx: ToolContext
): Promise<ApplyRuleOutput> {
  const startTime = Date.now();

  try {
    const {
      rule_id,
      input: ruleInput,
      context = {},
      dry_run = false,
      log_execution = true
    } = input;

    // Load rule definition
    if (!ctx.fileExists('global', 'rules', rule_id, 'definition.json')) {
      return {
        success: false,
        error: `Rule '${rule_id}' not found`
      };
    }

    const definition = await ctx.readJson('global', 'rules', rule_id, 'definition.json');

    // Validate input against schema
    const validationErrors = validateInput(ruleInput, definition.input_schema);
    if (validationErrors.length > 0) {
      return {
        success: false,
        errors: validationErrors,
        execution_time_ms: Date.now() - startTime
      };
    }

    // Execute based on rule type
    let result;
    const errors: string[] = [];

    switch (definition.type) {
      case 'validation':
        result = await executeValidation(definition, ruleInput, context);
        break;
      case 'conditional':
        result = await executeConditional(definition, ruleInput, context);
        break;
      case 'transformation':
        result = await executeTransformation(definition, ruleInput, context);
        break;
      case 'automation':
        result = await executeAutomation(definition, ruleInput, context, dry_run);
        break;
      case 'composite':
        result = await executeComposite(definition, ruleInput, context, ctx, dry_run);
        break;
      default:
        return {
          success: false,
          error: `Unknown rule type: ${definition.type}`
        };
    }

    const executionTime = Date.now() - startTime;

    // Log execution if not dry run
    if (!dry_run && log_execution) {
      await logExecution(ctx, rule_id, {
        timestamp: new Date().toISOString(),
        input: ruleInput,
        result,
        execution_time_ms: executionTime,
        success: result.success !== false
      });
    }

    return {
      success: true,
      result,
      errors: result.errors || [],
      execution_time_ms: executionTime,
      rules_applied: [rule_id]
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      execution_time_ms: Date.now() - startTime
    };
  }
}

/**
 * Validate input against JSON schema
 */
function validateInput(input: any, schema: any): string[] {
  const errors: string[] = [];
  
  if (!schema.properties) {
    return errors;
  }

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in input)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Check field types
  for (const [field, value] of Object.entries(input)) {
    const fieldSchema = schema.properties[field];
    if (!fieldSchema) {
      continue; // Allow extra fields
    }

    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (fieldSchema.type && actualType !== fieldSchema.type) {
      errors.push(`Field '${field}' must be of type ${fieldSchema.type}, got ${actualType}`);
    }
  }

  return errors;
}

/**
 * Execute validation rule
 */
async function executeValidation(definition: any, input: any, context: any) {
  const errors: string[] = [];
  
  // Evaluate conditions
  for (const condition of definition.conditions || []) {
    const result = evaluateCondition(condition, input, context);
    if (!result.passed) {
      errors.push(result.error || 'Validation failed');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Execute conditional rule
 */
async function executeConditional(definition: any, input: any, context: any) {
  // Evaluate all conditions
  for (const condition of definition.conditions || []) {
    const result = evaluateCondition(condition, input, context);
    if (!result.passed) {
      return { result: false, reason: result.error };
    }
  }

  return { result: true };
}

/**
 * Execute transformation rule
 */
async function executeTransformation(definition: any, input: any, context: any) {
  let output = { ...input };

  // Execute actions
  for (const action of definition.actions || []) {
    if (action.type === 'transform') {
      output = applyTransformation(output, action);
    }
  }

  return { transformed: output };
}

/**
 * Execute automation rule
 */
async function executeAutomation(definition: any, input: any, context: any, dryRun: boolean) {
  const actions_executed: string[] = [];

  // Check conditions first
  for (const condition of definition.conditions || []) {
    const result = evaluateCondition(condition, input, context);
    if (!result.passed) {
      return { executed: false, reason: 'Conditions not met' };
    }
  }

  // Execute actions
  if (!dryRun) {
    for (const action of definition.actions || []) {
      actions_executed.push(action.operation || action.type);
      // In real implementation, would execute actual actions
    }
  }

  return {
    executed: !dryRun,
    actions: actions_executed,
    dry_run: dryRun
  };
}

/**
 * Execute composite rule
 */
async function executeComposite(definition: any, input: any, context: any, ctx: ToolContext, dryRun: boolean) {
  const results: any[] = [];
  const rulesApplied: string[] = [];

  for (const depRuleId of definition.dependencies || []) {
    // Recursively apply dependent rules
    const depResult = await applyRule(
      { rule_id: depRuleId, input, context, dry_run: dryRun, log_execution: false },
      ctx
    );

    results.push(depResult);
    rulesApplied.push(depRuleId);
  }

  return {
    composite: true,
    results,
    rules_applied: rulesApplied
  };
}

/**
 * Evaluate a single condition
 */
function evaluateCondition(condition: any, input: any, context: any) {
  const { field, operator, value } = condition;
  
  // Get field value (supports nested paths like "user.email")
  const fieldValue = getNestedValue(input, field);

  let passed = false;

  switch (operator) {
    case 'eq':
      passed = fieldValue === value;
      break;
    case 'ne':
      passed = fieldValue !== value;
      break;
    case 'gt':
      passed = fieldValue > value;
      break;
    case 'gte':
      passed = fieldValue >= value;
      break;
    case 'lt':
      passed = fieldValue < value;
      break;
    case 'lte':
      passed = fieldValue <= value;
      break;
    case 'contains':
      passed = String(fieldValue).includes(String(value));
      break;
    case 'startsWith':
      passed = String(fieldValue).startsWith(String(value));
      break;
    case 'endsWith':
      passed = String(fieldValue).endsWith(String(value));
      break;
    case 'matches':
      passed = new RegExp(value).test(String(fieldValue));
      break;
    case 'in':
      passed = Array.isArray(value) && value.includes(fieldValue);
      break;
    case 'exists':
      passed = fieldValue !== undefined && fieldValue !== null;
      break;
    default:
      return { passed: false, error: `Unknown operator: ${operator}` };
  }

  return {
    passed,
    error: passed ? null : `Condition failed: ${field} ${operator} ${value}`
  };
}

/**
 * Get nested value from object
 */
function getNestedValue(obj: any, path: string) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Apply transformation
 */
function applyTransformation(data: any, action: any) {
  // Simple transformation logic
  // In real implementation, would support complex transformations
  return data;
}

/**
 * Log rule execution
 */
async function logExecution(ctx: ToolContext, rule_id: string, execution: any) {
  try {
    const metadata = await ctx.readJson('global', 'rules', rule_id, 'metadata.json');

    // Update usage stats
    metadata.usage_stats.total_executions++;
    if (execution.success) {
      metadata.usage_stats.success_count++;
    } else {
      metadata.usage_stats.failure_count++;
    }

    // Update average execution time
    const totalTime = metadata.usage_stats.avg_execution_time_ms * (metadata.usage_stats.total_executions - 1);
    metadata.usage_stats.avg_execution_time_ms = (totalTime + execution.execution_time_ms) / metadata.usage_stats.total_executions;

    await ctx.writeJson('global', 'rules', rule_id, 'metadata.json', metadata);
  } catch (error) {
    // Ignore logging errors
  }
}