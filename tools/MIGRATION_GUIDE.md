# Migration Guide: Externalizing Tools

This guide helps you migrate existing agents to use the externalized tools system.

## Overview

The externalized tools system provides:
- ✅ Centralized tool definitions
- ✅ Consistent tool interfaces
- ✅ Better discoverability
- ✅ Version management
- ✅ Reusability across agents

## Migration Steps

### Step 1: Audit Current Agent Tools

Review your agent configuration to see what tools it currently uses:

**Before:**
```json
{
  "id": "my_agent",
  "name": "My Agent",
  "tools": null
}
```

The agent implicitly has access to all tools through the system.

### Step 2: Identify Required Tools

Determine which tools your agent actually needs:

1. Review agent prompt and tasks
2. List all tool calls in the prompt
3. Identify minimum required tool set

Example analysis:
```
Agent: finance_tracker
Prompt mentions:
- Reading budget files → read_data_file
- Saving reports → write_data_file
- Checking current date → get_current_time

Required tools: basic_data + get_current_time
```

### Step 3: Update Agent Configuration

**Option A: Use Tool Set (Recommended)**
```json
{
  "id": "finance_tracker",
  "name": "Finance Tracker",
  "tool_set": "basic_data",
  "additional_tools": ["get_current_time"]
}
```

**Option B: Explicit Tool List**
```json
{
  "id": "finance_tracker",
  "name": "Finance Tracker",
  "tools": {
    "included": [
      "read_data_file",
      "write_data_file",
      "list_data_files",
      "get_current_time"
    ]
  }
}
```

**Option C: Category-Based**
```json
{
  "id": "finance_tracker",
  "name": "Finance Tracker",
  "tool_categories": ["data", "time"]
}
```

### Step 4: Update Agent Prompt

Update the agent's prompt to reference tools explicitly:

**Before:**
```markdown
You can read and write files as needed.
```

**After:**
```markdown
## Available Tools

You have access to the following tools:

### Data Tools
- `read_data_file`: Read JSON or MD files from data/ folder
- `write_data_file`: Write or update files in data/ folder
- `list_data_files`: List files in data/ subfolders

### Time Tools
- `get_current_time`: Get current date and time

Use these tools to accomplish your tasks.
```

### Step 5: Test the Migration

1. **Verify tool access**: Ensure agent can call all required tools
2. **Test edge cases**: Try operations that should fail (e.g., missing tools)
3. **Check performance**: Ensure no degradation
4. **Validate outputs**: Confirm results are identical

### Step 6: Update Documentation

Update any agent-specific documentation:
- README files
- Task descriptions
- Usage examples

## Migration Examples

### Example 1: Simple Data Agent

**Before:**
```json
{
  "id": "data_processor",
  "name": "Data Processor",
  "prompt_file": "data/prompts/processor.md"
}
```

**After:**
```json
{
  "id": "data_processor",
  "name": "Data Processor",
  "prompt_file": "data/prompts/processor.md",
  "tool_set": "basic_data"
}
```

### Example 2: Research Agent

**Before:**
```json
{
  "id": "researcher",
  "name": "Research Assistant",
  "prompt_file": "data/prompts/researcher.md"
}
```

**After:**
```json
{
  "id": "researcher",
  "name": "Research Assistant",
  "prompt_file": "data/prompts/researcher.md",
  "tool_set": "web_researcher",
  "additional_tools": ["write_data_file"]
}
```

### Example 3: System Builder Agent

**Before:**
```json
{
  "id": "system_builder",
  "name": "System Builder",
  "prompt_file": "data/prompts/builder.md"
}
```

**After:**
```json
{
  "id": "system_builder",
  "name": "System Builder",
  "prompt_file": "data/prompts/builder.md",
  "tool_set": "agent_builder",
  "additional_tools": ["search_global_patterns", "get_current_time"]
}
```

### Example 4: Full-Featured Agent

**Before:**
```json
{
  "id": "orchestrator",
  "name": "System Orchestrator",
  "prompt_file": "data/prompts/orchestrator.md"
}
```

**After:**
```json
{
  "id": "orchestrator",
  "name": "System Orchestrator",
  "prompt_file": "data/prompts/orchestrator.md",
  "tool_set": "full_stack"
}
```

## Common Migration Patterns

### Pattern 1: Minimal Tools

For agents that only need basic file operations:

```json
{
  "tool_set": "basic_data"
}
```

### Pattern 2: Specialized Tools

For agents with specific needs:

```json
{
  "tools": {
    "included": ["read_data_file", "web_search", "get_current_time"]
  }
}
```

### Pattern 3: Category-Based

For agents that need all tools in certain categories:

```json
{
  "tool_categories": ["data", "web"]
}
```

### Pattern 4: Exclusion-Based

For agents that need most tools except a few:

```json
{
  "tool_set": "full_stack",
  "tools": {
    "excluded": ["web_search", "web_fetch"]
  }
}
```

## Troubleshooting

### Issue: Agent can't find tool

**Symptom:**
```
Error: Tool 'read_data_file' not found
```

**Solution:**
1. Check tool is included in agent config
2. Verify tool ID spelling
3. Ensure tool exists in registry

### Issue: Missing required parameter

**Symptom:**
```
Error: Missing required parameter 'path'
```

**Solution:**
1. Review tool definition in tools/ folder
2. Check parameter requirements
3. Update agent prompt with correct usage

### Issue: Tool version mismatch

**Symptom:**
```
Warning: Tool version mismatch
```

**Solution:**
1. Check tool version in registry
2. Update agent to use compatible version
3. Review migration notes for breaking changes

## Best Practices

### 1. Start with Minimal Tools

Begin with the smallest tool set and add as needed:

```json
// Start here
{ "tool_set": "basic_data" }

// Add if needed
{ 
  "tool_set": "basic_data",
  "additional_tools": ["web_search"]
}
```

### 2. Document Tool Usage

In agent prompts, explain when to use each tool:

```markdown
## Tool Usage Guidelines

- Use `read_data_file` for accessing existing data
- Use `web_search` only when local data is insufficient
- Use `get_current_time` for timestamps and logging
```

### 3. Test Incrementally

Test each tool addition:

1. Add one tool
2. Test thoroughly
3. Add next tool
4. Repeat

### 4. Use Tool Sets When Possible

Prefer tool sets over explicit lists:

✅ Good:
```json
{ "tool_set": "agent_builder" }
```

❌ Less ideal:
```json
{ 
  "tools": ["upsert_agent", "upsert_task", "read_data_file", "write_data_file"]
}
```

### 5. Keep Prompts Updated

When tools change, update prompts:

```markdown
## Tools (Updated 2025-01-17)

- read_data_file v1.0.0
- write_data_file v1.0.0
- web_search v1.0.0
```

## Validation Checklist

Before completing migration:

- [ ] Agent config includes tool specification
- [ ] All required tools are accessible
- [ ] Agent prompt documents available tools
- [ ] Tests pass with new configuration
- [ ] Performance is acceptable
- [ ] Documentation is updated
- [ ] Edge cases are handled
- [ ] Error messages are clear

## Rollback Plan

If migration causes issues:

1. **Immediate rollback:**
   ```json
   {
     "tool_set": "full_stack"
   }
   ```

2. **Investigate issue:**
   - Check logs
   - Review tool calls
   - Test individual tools

3. **Fix and retry:**
   - Update configuration
   - Test thoroughly
   - Deploy again

## Next Steps

After migration:

1. **Monitor performance**: Track tool usage and performance
2. **Gather feedback**: Get user/agent feedback
3. **Optimize**: Remove unused tools, add needed ones
4. **Document**: Update any custom documentation
5. **Share learnings**: Help others migrate

## Support

For migration help:

1. Review [USAGE_GUIDE.md](USAGE_GUIDE.md)
2. Check [INDEX.md](INDEX.md) for tool reference
3. Examine [registry.json](registry.json) for tool details
4. Test with [validation script](#validation)

## Validation Script

Run this to validate your migration:

```bash
# Check agent configuration
npm run validate-agent <agent-id>

# Check tool availability
npm run check-tools <agent-id>

# Test tool calls
npm run test-agent-tools <agent-id>
```

## Timeline

Recommended migration timeline:

- **Week 1**: Audit and plan
- **Week 2**: Migrate critical agents
- **Week 3**: Migrate remaining agents
- **Week 4**: Testing and optimization

## Success Criteria

Migration is successful when:

- ✅ All agents have explicit tool configurations
- ✅ No agents use more tools than needed
- ✅ All tests pass
- ✅ Documentation is complete
- ✅ Performance is maintained or improved
- ✅ Team understands new system

## Additional Resources

- [Tool Schema](schema.json)
- [Tool Registry](registry.json)
- [Usage Guide](USAGE_GUIDE.md)
- [Tool Index](INDEX.md)
