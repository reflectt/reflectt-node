# Execute Agent Task

## Description

Delegate a task to another agent. The task must exist in `data/tasks/<agent-name>/<task-name>.json`. This allows agents to coordinate and break down complex work into specialized sub-tasks.

## Purpose and Use Cases

- **Task delegation**: Distribute work across specialized agents
- **Agent coordination**: Enable multi-agent collaboration on complex problems
- **Workflow automation**: Chain together multiple agent capabilities
- **Separation of concerns**: Let each agent focus on their domain expertise
- **Hierarchical task execution**: Parent agents can delegate to child agents

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent_name` | string | Name of the agent to execute the task (e.g., "general", "sales_agent", "developer") |
| `task_name` | string | Name of the task file without .json extension (e.g., "create-capability") |

## Output Format

```typescript
{
  success: boolean
  agent?: string
  task?: string
  result?: string  // Truncated to 500 characters
  error?: string
}
```

**Success Example:**
```json
{
  "success": true,
  "agent": "data_analyst",
  "task": "analyze-sales-trends",
  "result": "Analysis complete: Sales increased 15% in Q4 driven by..."
}
```

**Error Example:**
```json
{
  "success": false,
  "error": "Agent \"data_analyst\" not found"
}
```

## Example Usage

### Example 1: Delegate Data Analysis Task

```typescript
import executeAgentTask from './implementation'

const result = await executeAgentTask(
  {
    agent_name: 'data_analyst',
    task_name: 'analyze-sales-trends'
  },
  '/path/to/dataDir',
  loadAgent,  // Function to load agents
  executeAgent  // Function to execute agents
)

console.log(result)
// {
//   success: true,
//   agent: 'data_analyst',
//   task: 'analyze-sales-trends',
//   result: 'Analyzed 1,243 sales records. Key findings: ...'
// }
```

### Example 2: Delegate Code Generation Task

```typescript
const result = await executeAgentTask(
  {
    agent_name: 'developer',
    task_name: 'create-api-endpoint'
  },
  '/path/to/dataDir',
  loadAgent,
  executeAgent
)

// Developer agent reads the task file and generates the API code
```

### Example 3: Delegate Report Generation

```typescript
const result = await executeAgentTask(
  {
    agent_name: 'report_generator',
    task_name: 'monthly-summary'
  },
  '/path/to/dataDir',
  loadAgent,
  executeAgent
)
```

## Task File Format

The task file at `data/tasks/{agent_name}/{task_name}.json` should have this structure:

```json
{
  "id": "analyze-sales-trends",
  "title": "Analyze Sales Trends for Q4",
  "description": "Review sales data and identify key trends",
  "priority": "high",
  "status": "pending",
  "context": {
    "quarter": "Q4",
    "year": 2025,
    "focus_areas": ["revenue", "customer_segments"]
  },
  "steps": [
    {
      "step_number": 1,
      "description": "Load sales data from database",
      "completed": false
    },
    {
      "step_number": 2,
      "description": "Calculate trend metrics",
      "completed": false
    },
    {
      "step_number": 3,
      "description": "Generate insights report",
      "completed": false
    }
  ],
  "prompt_file": "data/prompts/analyst/sales-analysis.md"
}
```

## How It Works

### Execution Flow

1. **Load target agent**: Uses `loadAgent()` to find the agent configuration
2. **Load task file**: Reads `data/tasks/{agent_name}/{task_name}.json`
3. **Load prompt (optional)**: If task has `prompt_file`, loads that markdown file
4. **Build full prompt**: Combines prompt file + task details
5. **Execute sub-agent**: Calls `executeAgent()` with the constructed prompt
6. **Return result**: Returns truncated result (500 chars max)

### Prompt Construction

The function builds a comprehensive prompt:

```markdown
{Content from task.prompt_file if exists}

---

## Task Assignment

**Task ID:** analyze-sales-trends
**Title:** Analyze Sales Trends for Q4
**Description:** Review sales data and identify key trends
**Priority:** high
**Status:** pending

**Context:**
{
  "quarter": "Q4",
  "year": 2025,
  "focus_areas": ["revenue", "customer_segments"]
}

**Steps to Complete:**
1. Load sales data from database ⬜️
2. Calculate trend metrics ⬜️
3. Generate insights report ⬜️

**Task File Location:** data/tasks/data_analyst/analyze-sales-trends.json

Please complete this task according to the instructions above.
```

### Delegation Flag

The function calls `executeAgent()` with `isDelegated: true`, which:
- Prevents infinite recursion
- May adjust agent behavior for sub-tasks
- Enables tracking of delegation chains

## Error Handling

```typescript
// Agent not found
{
  agent_name: 'nonexistent_agent',
  task_name: 'some-task'
}
// Returns: { success: false, error: 'Agent "nonexistent_agent" not found' }

// Task file not found
{
  agent_name: 'data_analyst',
  task_name: 'missing-task'
}
// Returns: { success: false, error: 'Task "missing-task" not found for agent "data_analyst"' }

// Task file invalid JSON
// Returns: { success: false, error: 'Unexpected token ...' }

// Execution error
// Returns: { success: false, error: 'Error message from agent execution' }
```

## Context Requirements

This tool requires special context injected at runtime:

1. **`dataDir`**: Path to space-specific data directory
2. **`loadAgent`**: Function to load agent definitions
3. **`executeAgent`**: Function to execute agent with prompts

These are typically provided by the agent execution framework, not by end users.

## Best Practices

### 1. Create Well-Defined Tasks

```json
{
  "id": "task-001",
  "title": "Clear, specific title",
  "description": "Detailed description of what needs to be done",
  "context": {
    "all": "necessary",
    "contextual": "information"
  },
  "steps": [
    { "step_number": 1, "description": "Specific step", "completed": false }
  ]
}
```

### 2. Use Appropriate Agent for Task

```typescript
// Good: Delegate to specialist
await executeAgentTask({
  agent_name: 'sql_expert',
  task_name: 'optimize-query'
})

// Bad: Using generalist for specialized work
await executeAgentTask({
  agent_name: 'general',
  task_name: 'optimize-query'
})
```

### 3. Handle Delegation Results

```typescript
const result = await executeAgentTask(input, dataDir, loadAgent, executeAgent)

if (result.success) {
  console.log(`Task completed by ${result.agent}`)
  console.log(`Result preview: ${result.result}`)
  // Note: Full result is logged, truncated result returned
} else {
  console.error(`Delegation failed: ${result.error}`)
  // Implement fallback or retry logic
}
```

### 4. Organize Tasks by Agent

```
data/
├── tasks/
│   ├── data_analyst/
│   │   ├── analyze-sales-trends.json
│   │   ├── generate-forecast.json
│   │   └── calculate-metrics.json
│   ├── developer/
│   │   ├── create-api-endpoint.json
│   │   └── refactor-module.json
│   └── report_generator/
│       └── monthly-summary.json
```

## Use Case: Multi-Agent Workflow

```typescript
// Main orchestrator agent delegates to specialists

// Step 1: Gather data
const dataResult = await executeAgentTask({
  agent_name: 'data_collector',
  task_name: 'fetch-monthly-sales'
}, dataDir, loadAgent, executeAgent)

// Step 2: Analyze data
const analysisResult = await executeAgentTask({
  agent_name: 'data_analyst',
  task_name: 'analyze-trends'
}, dataDir, loadAgent, executeAgent)

// Step 3: Generate report
const reportResult = await executeAgentTask({
  agent_name: 'report_generator',
  task_name: 'create-executive-summary'
}, dataDir, loadAgent, executeAgent)

// All tasks completed by specialized agents
```

## Related Tools

- **upsert_task**: Create or update task definitions
- **get_task**: Retrieve task details
- **list_tasks**: List all tasks for an agent
- **load_agent**: Load agent configuration
- **upsert_agent**: Create or update agents
