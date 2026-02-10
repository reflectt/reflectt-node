# Event Triggering Pattern for Tools

## 🎯 Philosophy

**Tools should trigger events when they complete significant business operations that other parts of the system might want to react to.**

## 📋 Common Pattern

```typescript
// At the end of successful operation, after saving data:
try {
  await ctx.executeTool('trigger_event', {
    event_type: 'domain.action_past_tense',  // Use dot notation
    space_id: input.target_space || undefined,  // Let context handle defaults
    data: {
      // Include all relevant context for listeners
      id: recordId,
      details: operationDetails,
      metadata: relevantMetadata,
      timestamp: new Date().toISOString()
    },
    metadata: {
      source_tool: 'tool_name',
      operation: 'create|update|delete'
    }
  })
} catch (eventError) {
  // Don't fail the operation if event triggering fails
  console.warn(`Failed to trigger event: ${eventError}`)
}
```

## 🔑 Key Principles

1. **Non-blocking**: Wrap in try-catch, don't fail operation if event fails
2. **Past tense**: Use `record_created` not `create_record`
3. **Dot notation**: Domain-scoped like `data.record_created`
4. **Rich context**: Include everything listeners might need
5. **After success**: Only trigger after operation completes successfully

## 📊 Tools That Should Trigger Events

### **High Priority** (Business-critical operations)

#### 1. **Workflows** (`execute_workflow`)
- ✅ Already implemented in portals
- **Events to add**:
  - `workflow.started` - When execution begins
  - `workflow.completed` - When execution succeeds
  - `workflow.failed` - When execution fails
  - `workflow.step_completed` - After each step (optional)

#### 2. **Data Operations** (`upsert_record`, `delete_record`)
- **Events**:
  - `data.record_created` - New record created
  - `data.record_updated` - Existing record updated
  - `data.record_deleted` - Record removed
- **Data includes**: table, record_id, fields_changed, space_id

#### 3. **Agent/Task Execution** (`execute_task`, `chat_with_agent`)
- **Events**:
  - `agent.task_started` - Task execution begins
  - `agent.task_completed` - Task succeeds
  - `agent.task_failed` - Task fails
- **Data includes**: agent_slug, task_id, duration_ms, cost

#### 4. **Scheduled Jobs** (`schedule_workflow`, `check_scheduled_workflows`)
- **Events**:
  - `schedule.workflow_scheduled` - New schedule created
  - `schedule.workflow_triggered` - Scheduled job triggered
  - `schedule.workflow_disabled` - Schedule disabled
- **Data includes**: schedule_id, workflow_id, cron_expression, next_run

### **Medium Priority** (Operational monitoring)

#### 5. **Storage Operations** (`upsert_storage_file`, `delete_storage_file`)
- **Events**:
  - `storage.file_created` - New file created
  - `storage.file_updated` - File modified
  - `storage.file_deleted` - File removed
- **Data includes**: category, filename, file_size, space_id

#### 6. **Agent/Workflow Management** (`upsert_workflow`, `delete_workflow`)
- **Events**:
  - `system.workflow_created` - New workflow defined
  - `system.workflow_updated` - Workflow modified
  - `system.workflow_deleted` - Workflow removed
- **Data includes**: workflow_id, step_count, tags

#### 7. **Errors & Debugging** (`record_error`, `debug_suggest_fixes`)
- **Events**:
  - `system.error_recorded` - New error logged
  - `system.error_pattern_detected` - Recurring errors found
- **Data includes**: error_type, severity, stack_trace, suggestion_count

### **Low Priority** (Nice to have)

#### 8. **Cost Tracking** (`track_cost`, `analyze_cost`)
- **Events**:
  - `cost.threshold_exceeded` - Cost limit reached
  - `cost.anomaly_detected` - Unusual spending pattern
- **Data includes**: amount, period, category

#### 9. **Memory/Conversations** (`save_conversation`, `search_conversations`)
- **Events**:
  - `memory.conversation_saved` - New conversation stored
  - `memory.search_performed` - Search executed
- **Data includes**: conversation_id, message_count, participant

## 🎨 Event Naming Convention

Format: `{domain}.{entity}_{past_tense_action}`

**Examples**:
- ✅ `workflow.execution_started`
- ✅ `data.record_created`
- ✅ `agent.task_completed`
- ✅ `storage.file_updated`
- ✅ `system.error_recorded`
- ✅ `schedule.job_triggered`

**Not**:
- ❌ `workflowExecutionStarted` (no camelCase)
- ❌ `create_record` (use past tense)
- ❌ `record-created` (use dots for namespacing)

## 🔗 Event Data Schema

Every event should include:

```typescript
{
  // Required: Unique identifier for the resource
  id: string,
  
  // Required: What happened (summary)
  action: string,
  
  // Required: When it happened
  timestamp: string (ISO 8601),
  
  // Optional: Where it happened
  space_id?: string,
  
  // Optional: Who initiated it
  initiated_by?: {
    type: 'user' | 'agent' | 'system' | 'schedule' | 'event',
    id: string
  },
  
  // Domain-specific data
  ...entitySpecificFields
}
```

## 🚀 Implementation Guide

### Step 1: Add to end of tool implementation

```typescript
export default async function myTool(
  input: MyToolInput,
  ctx: ToolContext
): Promise<MyToolOutput> {
  // ... existing tool logic ...
  
  // Save result
  await ctx.writeJson(target, 'category', 'file.json', result)
  
  // 🎯 TRIGGER EVENT (new code)
  try {
    await ctx.executeTool('trigger_event', {
      event_type: 'domain.action_completed',
      space_id: input.target_space,
      data: {
        id: result.id,
        action: 'tool_operation',
        timestamp: new Date().toISOString(),
        ...relevantData
      },
      metadata: {
        source_tool: 'my_tool',
        operation: 'create'
      }
    })
  } catch (eventError) {
    console.warn(`Failed to trigger event: ${eventError}`)
  }
  
  return { success: true, ...result }
}
```

### Step 2: Test event triggering

```typescript
// Trigger test event
await trigger_event({
  event_type: 'test.event_triggered',
  data: { test: true }
})

// Check events table
cat data/spaces/hq/tables/events/*.json | jq '.event_type'
```

### Step 3: Create reactive workflow

```json
{
  "id": "my_reactive_workflow",
  "triggers": [
    {
      "type": "event",
      "event_type": "domain.action_completed"
    }
  ],
  "steps": [...]
}
```

## 📈 Observability Benefits

With event triggering:

1. **Audit Trail**: Complete history of all operations
2. **Reactive Automation**: Workflows trigger automatically
3. **Monitoring**: Track patterns and anomalies
4. **Debugging**: Trace operation sequences
5. **Analytics**: Measure system usage and performance

## 🎯 Quick Reference

| Tool Category | Event Pattern | Example |
|--------------|---------------|---------|
| **Workflows** | `workflow.{status}` | `workflow.completed` |
| **Data** | `data.record_{action}` | `data.record_created` |
| **Agents** | `agent.task_{status}` | `agent.task_completed` |
| **Storage** | `storage.file_{action}` | `storage.file_updated` |
| **System** | `system.{entity}_{action}` | `system.error_recorded` |
| **Schedule** | `schedule.{action}` | `schedule.job_triggered` |
| **Cost** | `cost.{event}` | `cost.threshold_exceeded` |

## 🔥 Priority Implementation Order

1. **Phase 1**: Workflows (started, completed, failed)
2. **Phase 2**: Data operations (record CRUD)
3. **Phase 3**: Agent task execution
4. **Phase 4**: Scheduled jobs
5. **Phase 5**: Everything else

Start with workflow events since they're already partially implemented and provide the most value for autonomous operations.
