# Execute Workflow Tool - Self-Contained Implementation

## Overview

This tool provides a complete, self-contained workflow execution engine with dependency resolution, parallel execution, and error handling. All dependencies have been inlined - no external imports except Node.js built-ins.

## Features

### 1. Dependency Resolution
- **Topological Sort**: Automatically orders steps based on dependencies
- **Circular Dependency Detection**: Validates workflow DAG using DFS
- **Parallel Execution**: Groups independent steps into waves for concurrent execution
- **Variable Resolution**: Supports `{{step_id.field}}` and `{{context.var}}` references

### 2. Execution Engine
- **Wave-Based Execution**: Steps with satisfied dependencies run in parallel
- **Retry Logic**: Configurable retry with exponential backoff (1s, 2s, 4s, 8s...)
- **Error Handling**: Three strategies - `fail`, `continue`, `retry`
- **State Persistence**: All execution state saved to JSON files

### 3. Tool Loading
- **Dynamic Loading**: Loads tool implementations at runtime
- **Format**: Tools must be in `tools/[category]/[name]/implementation.ts`
- **Isolation**: Each tool runs in its own context

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `workflow_id` | string | ID of workflow to execute |

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `context` | object | {} | Context variables for {{context.var}} references |
| `target_space` | string | - | Execute in specific space instead of dataDir |
| `sync` | boolean | false | Wait for completion (true) or run in background (false) |

## Output Format

```typescript
interface ExecuteWorkflowOutput {
  success: boolean              // Whether execution started/completed successfully
  execution_id?: string         // UUID of execution record
  status?: string               // Current status (running, completed, failed)
  path?: string                 // Relative path to execution record JSON
  result?: any                  // Full execution record (if sync=true)
  error?: string                // Error message if failed
}
```

## Example Usage

```typescript
import executeWorkflow from './implementation'

// Execute workflow synchronously (wait for completion)
const result = await executeWorkflow({
  workflow_id: 'my-workflow',
  context: { userId: '123', action: 'approve' },
  sync: true
}, dataDir, globalDir)

console.log(result)
// {
//   success: true,
//   execution_id: 'uuid',
//   status: 'completed',
//   path: 'workflows/my-workflow/executions/uuid.json',
//   result: { /* execution record */ }
// }

// Execute workflow asynchronously (background)
const result = await executeWorkflow({
  workflow_id: 'my-workflow',
  context: { userId: '123' },
  sync: false
}, dataDir, globalDir)

console.log(result)
// {
//   success: true,
//   execution_id: 'uuid',
//   status: 'running',
//   path: 'workflows/my-workflow/executions/uuid.json'
// }
```

## Workflow Definition Format

Workflows are stored in `workflows/[workflow_id]/definition.json`:

```json
{
  "id": "example-workflow",
  "name": "Example Workflow",
  "description": "Demonstrates workflow features",
  "steps": [
    {
      "id": "fetch_data",
      "tool": "data/fetch",
      "inputs": {
        "url": "{{context.api_url}}",
        "userId": "{{context.userId}}"
      }
    },
    {
      "id": "process_data",
      "tool": "data/transform",
      "depends_on": ["fetch_data"],
      "inputs": {
        "data": "{{fetch_data.result}}",
        "format": "json"
      },
      "error_handling": "retry",
      "max_retries": 3
    },
    {
      "id": "save_result",
      "tool": "data/save",
      "depends_on": ["process_data"],
      "inputs": {
        "data": "{{process_data.output}}",
        "path": "results/{{context.userId}}.json"
      }
    }
  ]
}
```

## Step Configuration

### Required Fields
- `id`: Unique step identifier (used for dependencies and variable references)
- `tool`: Tool to execute (format: `category/name`)

### Optional Fields
- `depends_on`: Array of step IDs that must complete first
- `inputs`: Input values for the tool (supports variable substitution)
- `error_handling`: Strategy for failures (`fail`, `continue`, `retry`)
- `max_retries`: Number of retry attempts (defaults to 3 if `error_handling: retry`)

### Error Handling Strategies

1. **fail** (default): Stop entire workflow on error
2. **continue**: Log error and continue to next step (result = null)
3. **retry**: Retry with exponential backoff before failing

## Variable Resolution

The engine supports two types of variable references:

### 1. Step Results
Reference outputs from previous steps:
```json
{
  "inputs": {
    "data": "{{fetch_data.result}}",
    "userId": "{{fetch_data.user.id}}"
  }
}
```

### 2. Context Variables
Reference variables passed in `context`:
```json
{
  "inputs": {
    "apiUrl": "{{context.api_url}}",
    "userId": "{{userId}}"
  }
}
```

## Execution Waves

The engine automatically groups steps for parallel execution:

```
Workflow with dependencies:
  A → B → D
  A → C → D

Execution Plan:
  Wave 1: A
  Wave 2: B, C (parallel)
  Wave 3: D
```

Steps in the same wave have no dependencies between them and run concurrently.

## Implementation Details

**File**: 811 lines, self-contained
**Dependencies**: Only Node.js built-ins (fs, path, crypto)
**Code Organization**:
1. Type Definitions
2. Dependency Resolution (topological sort, DFS cycle detection)
3. Tool Loading (dynamic import)
4. Execution Record Management
5. Step Execution (with retry logic)
6. Workflow Engine (wave-based execution)
7. Main Export

## Error Handling

The function returns structured error responses when issues occur:
- Missing workflow: `{ success: false, error: 'Workflow not found: ...' }`
- Circular dependencies: Throws error during validation
- Step failures: Recorded in execution record with error history

## Related Tools

- `workflows/create_workflow` - Create new workflows
- `workflows/list_workflows` - List available workflows
- `workflows/get_workflow_status` - Check execution status
