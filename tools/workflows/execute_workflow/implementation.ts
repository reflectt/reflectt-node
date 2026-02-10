/**
 * Self-contained workflow execution tool
 *
 * This tool executes workflows with dependency resolution, parallel execution, and error handling.
 * All dependencies are inlined - no external imports except Node.js built-ins.
 *
 * EXECUTION METHODS:
 *
 * 1. Tool-based execution (step.tool):
 *    - Executes a tool directly using context.executeTool()
 *    - Example: { "id": "step1", "tool": "analytics/calculate_metrics", "inputs": {...} }
 *
 * 2. Agent/task-based execution (step.agent + step.task):
 *    - Executes a task using context.executeTool('execute_task', ...)
 *    - Passes workflow context to task for variable access
 *    - Example: { "id": "step1", "agent": "story_writer", "task": "write-story", "inputs": {...} }
 *
 * DEPENDENCY RESOLUTION:
 * - Steps can reference outputs from previous steps using {{step_id.field}} syntax
 * - Workflow context can be accessed with {{context.field}}
 * - Topological sort ensures dependencies are executed before dependents
 * - Parallel execution of steps in same dependency wave
 *
 * ERROR HANDLING:
 * - fail: Stop workflow on error (default)
 * - continue: Log error and continue to next step
 * - retry: Retry step with exponential backoff (max 3 retries)
 */

import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  validateRequired,
  type ToolContext,
} from '@/lib/tools/helpers'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ExecuteWorkflowInput {
  workflow_id: string
  context?: Record<string, any>
  target_space?: string
  sync?: boolean  // If true, wait for completion
}

interface ExecuteWorkflowOutput {
  success: boolean
  execution_id?: string
  status?: string
  path?: string
  result?: any
  error?: string
}

interface WorkflowStep {
  id: string
  depends_on?: string[]
  inputs?: Record<string, any>
  tool?: string
  agent?: string  // Agent name for agent/task execution
  task?: string   // Task name for agent/task execution
  capability?: string
  error_handling?: 'fail' | 'continue' | 'retry'
  max_retries?: number
  _startTime?: number
  [key: string]: any
}

interface WorkflowDefinition {
  id: string
  name: string
  description?: string
  steps: WorkflowStep[]
  version?: string
}

interface DependencyGraph {
  nodes: Set<string>
  edges: Map<string, Set<string>>  // node -> dependencies
  reverseEdges: Map<string, Set<string>>  // node -> dependents
}

interface ExecutionRecord {
  id: string
  workflow_id: string
  workflow_name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  started_at: string
  completed_at?: string
  duration_ms?: number
  step_executions: {
    [step_id: string]: StepExecution
  }
  context: Record<string, any>
  error?: string
  failed_step?: string
}

interface StepExecution {
  step_id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  started_at?: string
  completed_at?: string
  duration_ms?: number
  retry_count: number
  result?: any
  error?: string
  error_history?: Array<{
    attempt: number
    error: string
    timestamp: string
  }>
}

// ============================================================================
// DEPENDENCY RESOLUTION (from dependency-resolver.ts)
// ============================================================================

/**
 * Build dependency graph from workflow steps
 */
function buildDependencyGraph(steps: WorkflowStep[]): DependencyGraph {
  const graph: DependencyGraph = {
    nodes: new Set(),
    edges: new Map(),
    reverseEdges: new Map()
  }

  // Initialize all nodes
  for (const step of steps) {
    graph.nodes.add(step.id)
    graph.edges.set(step.id, new Set())
    graph.reverseEdges.set(step.id, new Set())
  }

  // Build edges
  for (const step of steps) {
    const dependencies = step.depends_on || []

    for (const dep of dependencies) {
      if (!graph.nodes.has(dep)) {
        throw new Error(`Step "${step.id}" depends on non-existent step "${dep}"`)
      }

      graph.edges.get(step.id)!.add(dep)
      graph.reverseEdges.get(dep)!.add(step.id)
    }
  }

  return graph
}

/**
 * Validate no circular dependencies using DFS
 */
function validateNoCycles(steps: WorkflowStep[]): boolean {
  const graph = buildDependencyGraph(steps)
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  function hasCycleDFS(node: string): boolean {
    visited.add(node)
    recursionStack.add(node)

    const dependencies = graph.edges.get(node) || new Set()
    for (const dep of Array.from(dependencies)) {
      if (!visited.has(dep)) {
        if (hasCycleDFS(dep)) {
          return true
        }
      } else if (recursionStack.has(dep)) {
        // Found a cycle
        return true
      }
    }

    recursionStack.delete(node)
    return false
  }

  for (const node of Array.from(graph.nodes)) {
    if (!visited.has(node)) {
      if (hasCycleDFS(node)) {
        throw new Error('Circular dependency detected in workflow')
      }
    }
  }

  return true
}

/**
 * Compute execution waves for parallel execution using topological sort
 * Returns array of arrays - each inner array contains steps that can run in parallel
 */
function computeExecutionWaves(steps: WorkflowStep[]): string[][] {
  // Validate no cycles first
  validateNoCycles(steps)

  const waves: string[][] = []
  const completed = new Set<string>()
  const remaining = new Set(steps.map(s => s.id))

  while (remaining.size > 0) {
    const wave: string[] = []

    // Find all steps whose dependencies are satisfied
    for (const step of steps) {
      if (!remaining.has(step.id)) continue

      const dependencies = step.depends_on || []
      const dependenciesMet = dependencies.every(dep => completed.has(dep))

      if (dependenciesMet) {
        wave.push(step.id)
      }
    }

    if (wave.length === 0) {
      // This should never happen if validateNoCycles passed
      throw new Error('Unable to resolve dependencies - possible circular reference')
    }

    waves.push(wave)

    // Mark wave steps as completed
    for (const stepId of wave) {
      remaining.delete(stepId)
      completed.add(stepId)
    }
  }

  return waves
}

/**
 * Navigate nested object path
 */
function navigateObject(obj: any, path: string[]): any {
  let current = obj

  for (const field of path) {
    if (current === null || current === undefined) {
      throw new Error(`Cannot access field "${field}" on null/undefined`)
    }

    if (typeof current !== 'object') {
      throw new Error(`Cannot access field "${field}" on non-object value`)
    }

    if (!(field in current)) {
      throw new Error(`Field "${field}" not found in object`)
    }

    current = current[field]
  }

  return current
}

/**
 * Resolve a variable path like "step_id.field.nested" or "steps.step_id.field"
 */
function resolveVariablePath(
  varPath: string,
  context: Record<string, any>,
  previousResults: Map<string, any>
): any {
  const parts = varPath.split('.')

  // Special handling for single-part variables - check step results first
  if (parts.length === 1) {
    const varName = parts[0]
    
    // Check if it's a step result first
    if (previousResults.has(varName)) {
      return previousResults.get(varName)
    }
    
    // Otherwise try context
    return navigateObject(context, [varName])
  }

  // Check if it starts with "context."
  if (parts[0] === 'context') {
    const contextPath = parts.slice(1)
    return navigateObject(context, contextPath)
  }

  // Check if it uses "steps.step_id.field" syntax (common pattern)
  if (parts[0] === 'steps' && parts.length >= 2) {
    const stepId = parts[1]
    const fieldPath = parts.slice(2)

    if (!previousResults.has(stepId)) {
      throw new Error(`Step "${stepId}" has not completed yet or has no result`)
    }

    const stepResult = previousResults.get(stepId)

    // If no field path, return entire result
    if (fieldPath.length === 0) {
      return stepResult
    }

    // Navigate to nested field
    return navigateObject(stepResult, fieldPath)
  }

  // Check if first part is a context variable (e.g., "input.field" where "input" is in context)
  if (parts.length > 1 && parts[0] in context) {
    return navigateObject(context, parts)
  }

  // Otherwise, it's a direct step result reference (step_id.field...)
  const stepId = parts[0]
  const fieldPath = parts.slice(1)

  if (!previousResults.has(stepId)) {
    throw new Error(`Step "${stepId}" has not completed yet or has no result`)
  }

  const stepResult = previousResults.get(stepId)

  // If no field path, return entire result
  if (fieldPath.length === 0) {
    return stepResult
  }

  // Navigate to nested field
  return navigateObject(stepResult, fieldPath)
}

/**
 * Resolve string value that might contain {{variable}} references
 */
function resolveStringValue(
  value: string,
  context: Record<string, any>,
  previousResults: Map<string, any>
): any {
  // Check if entire string is a variable reference
  if (value.startsWith('{{') && value.endsWith('}}')) {
    const varPath = value.slice(2, -2).trim()
    return resolveVariablePath(varPath, context, previousResults)
  }

  // Replace inline variable references
  return value.replace(/\{\{([^}]+)\}\}/g, (match, varPath) => {
    const resolved = resolveVariablePath(varPath.trim(), context, previousResults)
    return String(resolved)
  })
}

/**
 * Recursively resolve a value that might contain variable references
 */
function resolveValue(
  value: any,
  context: Record<string, any>,
  previousResults: Map<string, any>
): any {
  if (typeof value === 'string') {
    return resolveStringValue(value, context, previousResults)
  } else if (Array.isArray(value)) {
    return value.map(item => resolveValue(item, context, previousResults))
  } else if (value !== null && typeof value === 'object') {
    const resolved: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolveValue(v, context, previousResults)
    }
    return resolved
  }

  return value
}

/**
 * Resolve step inputs by replacing {{step_id.field}} variables
 * with actual values from previous step results
 */
function resolveStepInputs(
  step: WorkflowStep,
  context: Record<string, any>,
  previousResults: Map<string, any>
): Record<string, any> {
  const resolved: Record<string, any> = {}
  const inputs = step.inputs || {}

  for (const [key, value] of Object.entries(inputs)) {
    resolved[key] = resolveValue(value, context, previousResults)
  }

  return resolved
}

// ============================================================================
// TOOL LOADING (simplified from tool-loader.ts)
// ============================================================================

// NOTE: Tool loading and execution is now handled by context.executeTool()
// This eliminates the need for custom tool loading logic and ensures
// consistent execution through the tool system.

// ============================================================================
// EXECUTION RECORD MANAGEMENT
// ============================================================================

/**
 * Update execution status in file (with file locking to prevent race conditions)
 */
async function updateExecutionStatus(
  ctx: ToolContext,
  targetSpace: string | undefined,
  workflowId: string,
  executionId: string,
  status: ExecutionRecord['status'],
  error?: string,
  failedStep?: string,
  duration?: number
): Promise<void> {
  await withExecutionLock(executionId, async () => {
    try {
      const execution = await ctx.readJson(targetSpace, 'workflows', workflowId, 'executions', `${executionId}.json`)

      execution.status = status

      if (status === 'completed' || status === 'failed') {
        execution.completed_at = new Date().toISOString()
      }

      if (duration !== undefined) {
        execution.duration_ms = duration
      }

      if (error) {
        execution.error = error
      }

      if (failedStep) {
        execution.failed_step = failedStep
      }

      await ctx.writeJson(targetSpace, 'workflows', workflowId, 'executions', `${executionId}.json`, execution)
    } catch (err) {
      console.error('Failed to update execution status:', err)
    }
  })
}

// Simple in-memory lock for file writes (prevents race conditions in parallel execution)
const executionFileLocks = new Map<string, Promise<void>>()

/**
 * Execute a function with exclusive lock on execution file
 */
async function withExecutionLock<T>(
  executionId: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockKey = executionId

  // Wait for any existing lock
  while (executionFileLocks.has(lockKey)) {
    await executionFileLocks.get(lockKey)
  }

  // Create new lock
  let releaseLock: () => void
  const lockPromise = new Promise<void>(resolve => {
    releaseLock = resolve
  })
  executionFileLocks.set(lockKey, lockPromise)

  try {
    return await fn()
  } finally {
    // Release lock
    executionFileLocks.delete(lockKey)
    releaseLock!()
  }
}

/**
 * Update step status in execution file (with file locking to prevent race conditions)
 */
async function updateStepStatus(
  ctx: ToolContext,
  targetSpace: string | undefined,
  workflowId: string,
  executionId: string,
  stepId: string,
  status: StepExecution['status'],
  result?: any,
  error?: string,
  duration?: number
): Promise<void> {
  await withExecutionLock(executionId, async () => {
    try {
      const execution = await ctx.readJson(targetSpace, 'workflows', workflowId, 'executions', `${executionId}.json`)

      if (!execution.step_executions[stepId]) {
        execution.step_executions[stepId] = {
          step_id: stepId,
          status: 'pending',
          retry_count: 0
        }
      }

      const stepExec = execution.step_executions[stepId]

      stepExec.status = status

      if (status === 'running' && !stepExec.started_at) {
        stepExec.started_at = new Date().toISOString()
      }

      if (status === 'completed' || status === 'failed') {
        stepExec.completed_at = new Date().toISOString()
      }

      if (duration !== undefined) {
        stepExec.duration_ms = duration
      }

      if (result !== undefined) {
        stepExec.result = result
      }

      if (error) {
        stepExec.error = error
      }

      await ctx.writeJson(targetSpace, 'workflows', workflowId, 'executions', `${executionId}.json`, execution)
    } catch (err) {
      console.error('Failed to update step status:', err)
    }
  })
}

/**
 * Update step retry count (with file locking to prevent race conditions)
 */
async function updateStepRetryCount(
  ctx: ToolContext,
  targetSpace: string | undefined,
  workflowId: string,
  executionId: string,
  stepId: string,
  retryCount: number
): Promise<void> {
  await withExecutionLock(executionId, async () => {
    try {
      const execution = await ctx.readJson(targetSpace, 'workflows', workflowId, 'executions', `${executionId}.json`)

      if (!execution.step_executions[stepId]) {
        execution.step_executions[stepId] = {
          step_id: stepId,
          status: 'pending',
          retry_count: 0
        }
      }

      execution.step_executions[stepId].retry_count = retryCount

      await ctx.writeJson(targetSpace, 'workflows', workflowId, 'executions', `${executionId}.json`, execution)
    } catch (err) {
      console.error('Failed to update retry count:', err)
    }
  })
}

/**
 * Log step error to history (with file locking to prevent race conditions)
 */
async function logStepError(
  ctx: ToolContext,
  targetSpace: string | undefined,
  workflowId: string,
  executionId: string,
  stepId: string,
  attempt: number,
  error: Error
): Promise<void> {
  await withExecutionLock(executionId, async () => {
    try {
      const execution = await ctx.readJson(targetSpace, 'workflows', workflowId, 'executions', `${executionId}.json`)

      if (!execution.step_executions[stepId]) {
        execution.step_executions[stepId] = {
          step_id: stepId,
          status: 'pending',
          retry_count: 0
        }
      }

      const stepExec = execution.step_executions[stepId]

      if (!stepExec.error_history) {
        stepExec.error_history = []
      }

      stepExec.error_history.push({
        attempt: attempt + 1,
        error: error.message,
        timestamp: new Date().toISOString()
      })

      await ctx.writeJson(targetSpace, 'workflows', workflowId, 'executions', `${executionId}.json`, execution)
    } catch (err) {
      console.error('Failed to log step error:', err)
    }
  })
}

// ============================================================================
// AGENT/TASK EXECUTION
// ============================================================================

// NOTE: Agent/task execution is now handled by context.executeTool('execute_task', ...)
// This eliminates custom task execution logic and routes all execution through
// the standardized tool system.

// ============================================================================
// STEP EXECUTION
// ============================================================================

/**
 * Execute a single step with retry logic
 */
async function executeStep(
  step: WorkflowStep,
  ctx: ToolContext,
  targetSpace: string | undefined,
  workflowSpace: string | undefined,
  workflowId: string,
  executionId: string,
  workflowContext: Record<string, any>,
  previousResults: Map<string, any>
): Promise<any> {
  const maxRetries = step.max_retries || (step.error_handling === 'retry' ? 3 : 0)
  let lastError: Error | null = null
  const startTime = Date.now()

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Update retry count
      updateStepRetryCount(ctx, targetSpace, workflowId, executionId, step.id, attempt)

      // Update step status to 'running' on first attempt
      if (attempt === 0) {
        await updateStepStatus(ctx, targetSpace, workflowId, executionId, step.id, 'running')
      }

      // Resolve step inputs
      const resolvedInputs = resolveStepInputs(
        step,
        workflowContext,
        previousResults
      )

      // Execute step based on execution method
      let result: any

      if (step.tool) {
        // Tool-based execution - direct tool call
        result = await ctx.executeTool(step.tool, resolvedInputs)
      } else if (step.agent && step.task) {
        // Agent/task-based execution - execute via execute_task tool
        const taskResult = await ctx.executeTool('execute_task', {
          agent_name: step.agent,
          task_name: step.task,
          input: resolvedInputs,
          context: {
            ...workflowContext,
            workflow_id: workflowId,
            step_id: step.id,
            execution_id: executionId,
            previous_results: Object.fromEntries(previousResults),
            space_id: targetSpace || ctx.currentSpace,
            workflow_space: workflowSpace // Pass workflow space for agent/task lookup
          }
        })

        // Check if task execution succeeded
        if (!taskResult.success) {
          throw new Error(taskResult.error || 'Task execution failed')
        }

        // Extract result from task execution
        result = taskResult.result || taskResult.output || taskResult
      } else {
        throw new Error(
          `Step ${step.id} must have either 'tool' or 'agent'+'task' specified`
        )
      }

      // Save step result
      const duration = Date.now() - startTime
      await updateStepStatus(ctx, targetSpace, workflowId, executionId, step.id, 'completed', result, undefined, duration)

      return result
    } catch (error) {
      lastError = error as Error

      // Log error to history
      await logStepError(ctx, targetSpace, workflowId, executionId, step.id, attempt, lastError)

      // If we have retries left, wait and retry
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000 // 1s, 2s, 4s, 8s...
        console.log(`   ⏳ Retrying step ${step.id} in ${delay}ms (attempt ${attempt + 2}/${maxRetries + 1})`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  // All retries exhausted
  const duration = Date.now() - startTime
  const errorMessage = `Step ${step.id} failed after ${maxRetries + 1} attempts: ${lastError?.message}`
  await updateStepStatus(ctx, targetSpace, workflowId, executionId, step.id, 'failed', null, errorMessage, duration)

  throw new Error(errorMessage)
}

// ============================================================================
// WORKFLOW EXECUTION ENGINE
// ============================================================================

/**
 * Execute a workflow with dependency resolution and parallel execution
 */
async function executeWorkflowEngine(
  workflow: WorkflowDefinition,
  ctx: ToolContext,
  targetSpace: string | undefined,
  workflowSpace: string | undefined,
  executionId: string,
  workflowContext: Record<string, any>
): Promise<void> {
  console.log(`\n🚀 Starting workflow: ${workflow.name}`)
  console.log(`   Execution ID: ${executionId}`)
  console.log(`   Steps: ${workflow.steps.length}`)
  console.log(`   Space: ${targetSpace || ctx.currentSpace}\n`)

  // Trigger workflow.started event
  try {
    await ctx.executeTool('trigger_event', {
      event_type: 'workflow.started',
      space_id: targetSpace === ctx.currentSpace ? undefined : targetSpace,
      data: {
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        execution_id: executionId,
        step_count: workflow.steps.length,
        timestamp: new Date().toISOString()
      },
      metadata: {
        source_tool: 'execute_workflow',
        operation: 'workflow_execution'
      }
    })
  } catch (eventError) {
    console.warn(`Failed to trigger workflow.started event: ${eventError}`)
  }

  const startTime = Date.now()

  try {
    // Update status to 'running'
    await updateExecutionStatus(ctx, targetSpace, workflow.id, executionId, 'running')

    // Compute execution waves (topological sort with parallel detection)
    const waves = computeExecutionWaves(workflow.steps)

    console.log(`\n📊 Workflow execution plan:`)
    waves.forEach((wave, idx) => {
      console.log(`   Wave ${idx + 1}: ${wave.join(', ')}${wave.length > 1 ? ' (parallel)' : ''}`)
    })
    console.log('')

    // Store results from completed steps
    const previousResults = new Map<string, any>()

    // Execute waves sequentially
    for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
      const wave = waves[waveIdx]

      console.log(`\n🌊 Executing Wave ${waveIdx + 1}/${waves.length}...`)

      // Execute all steps in wave in parallel
      const waveResults = await Promise.allSettled(
        wave.map(stepId => {
          const step = workflow.steps.find(s => s.id === stepId)!
          return executeStep(step, ctx, targetSpace, workflowSpace, workflow.id, executionId, workflowContext, previousResults)
        })
      )

      // Process results and check for failures
      for (let i = 0; i < waveResults.length; i++) {
        const result = waveResults[i]
        const stepId = wave[i]
        const step = workflow.steps.find(s => s.id === stepId)!

        if (result.status === 'fulfilled') {
          // Step succeeded
          previousResults.set(stepId, result.value)
          console.log(`   ✅ ${stepId}: completed`)
        } else {
          // Step failed
          const error = result.reason as Error
          console.log(`   ❌ ${stepId}: failed - ${error.message}`)

          // Check error handling strategy
          const errorStrategy = step.error_handling || 'fail'

          if (errorStrategy === 'fail') {
            // Fail entire workflow
            const duration = Date.now() - startTime
            await updateExecutionStatus(ctx, targetSpace, workflow.id, executionId, 'failed', error.message, stepId, duration)
            return
          } else if (errorStrategy === 'continue') {
            // Log error but continue to next step
            previousResults.set(stepId, null)
            continue
          } else if (errorStrategy === 'retry') {
            // Retry logic handled in executeStep, if we get here retries exhausted
            // Treat as 'fail'
            const duration = Date.now() - startTime
            await updateExecutionStatus(ctx, targetSpace, workflow.id, executionId, 'failed', error.message, stepId, duration)
            return
          }
        }
      }
    }

    // All steps complete
    const duration = Date.now() - startTime
    await updateExecutionStatus(ctx, targetSpace, workflow.id, executionId, 'completed', undefined, undefined, duration)

    console.log(`\n✅ Workflow completed successfully in ${duration}ms\n`)

    // Trigger workflow.completed event
    try {
      await ctx.executeTool('trigger_event', {
        event_type: 'workflow.completed',
        space_id: targetSpace === ctx.currentSpace ? undefined : targetSpace,
        data: {
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          execution_id: executionId,
          duration_ms: duration,
          step_count: workflow.steps.length,
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'execute_workflow',
          operation: 'workflow_execution'
        }
      })
    } catch (eventError) {
      console.warn(`Failed to trigger workflow.completed event: ${eventError}`)
    }
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await updateExecutionStatus(ctx, targetSpace, workflow.id, executionId, 'failed', errorMessage, undefined, duration)

    console.error(`\n❌ Workflow failed: ${errorMessage}\n`)

    // Trigger workflow.failed event
    try {
      await ctx.executeTool('trigger_event', {
        event_type: 'workflow.failed',
        space_id: targetSpace === ctx.currentSpace ? undefined : targetSpace,
        data: {
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          execution_id: executionId,
          duration_ms: duration,
          error: errorMessage,
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'execute_workflow',
          operation: 'workflow_execution'
        }
      })
    } catch (eventError) {
      console.warn(`Failed to trigger workflow.failed event: ${eventError}`)
    }
  }
}

// ============================================================================
// MAIN TOOL EXPORT
// ============================================================================

export default async function executeWorkflow(
  input: ExecuteWorkflowInput,
  ctx: ToolContext
): Promise<ExecuteWorkflowOutput> {
  try {
    const validation = validateRequired(input.workflow_id, 'workflow_id')
    if (!validation.valid) {
      return { success: false, error: validation.errors[0].message }
    }

    // Load workflow definition from workflows/[workflow_id]/definition.json
    // Check target space first, then fallback to global
    let workflow: any = null
    let workflowSpace: string | undefined = input.target_space
    
    if (ctx.fileExists(input.target_space, 'workflows', input.workflow_id, 'definition.json')) {
      workflow = await ctx.readJson(input.target_space, 'workflows', input.workflow_id, 'definition.json')
    } else if (ctx.fileExists('global', 'workflows', input.workflow_id, 'definition.json')) {
      workflow = await ctx.readJson('global', 'workflows', input.workflow_id, 'definition.json')
      workflowSpace = 'global'
    }
    
    if (!workflow) {
      return { success: false, error: `Workflow not found: ${input.workflow_id}` }
    }

    // Create execution record
    const executionId = randomUUID()
    const execution: ExecutionRecord = {
      id: executionId,
      workflow_id: input.workflow_id,
      workflow_name: workflow.name,
      status: 'pending',
      started_at: new Date().toISOString(),
      step_executions: {},
      context: input.context || {}
    }

    // Initialize step executions
    for (const step of workflow.steps) {
      execution.step_executions[step.id] = {
        step_id: step.id,
        status: 'pending',
        retry_count: 0
      }
    }

    // Save execution record to workflows/[workflow_id]/executions/[execution_id].json
    const relativePath = path.join('workflows', input.workflow_id, 'executions', `${executionId}.json`)

    // Ensure executions directory exists
    await ctx.ensureDir(input.target_space, 'workflows', input.workflow_id, 'executions')

    // Write execution record
    await ctx.writeJson(input.target_space, 'workflows', input.workflow_id, 'executions', `${executionId}.json`, execution)

    // Execute workflow
    if (input.sync) {
      // Synchronous execution - wait for completion
      console.log(`🔄 Executing workflow "${workflow.name}" synchronously...`)

      await executeWorkflowEngine(workflow, ctx, input.target_space, workflowSpace, executionId, input.context || {})

      // Load final execution record
      const finalExecution = await ctx.readJson(input.target_space, 'workflows', input.workflow_id, 'executions', `${executionId}.json`)

      return {
        success: finalExecution.status === 'completed',
        execution_id: executionId,
        status: finalExecution.status,
        path: relativePath,
        result: finalExecution,
        error: finalExecution.error
      }
    } else {
      // Asynchronous execution - start in background
      console.log(`🚀 Starting workflow "${workflow.name}" in background...`)

      // Start background execution (don't await)
      executeWorkflowEngine(workflow, ctx, input.target_space, workflowSpace, executionId, input.context || {})
        .catch(err => {
          // Log error but don't throw (background execution)
          console.error(`❌ Workflow ${executionId} failed:`, err.message)
        })

      // Return immediately
      return {
        success: true,
        execution_id: executionId,
        status: 'running',
        path: relativePath
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
