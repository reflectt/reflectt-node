# Tools Usage Guide

This guide explains how to use the externalized tools system in your agent configurations and workflows.

## Quick Start

### 1. Reference Tools in Agent Config

```json
{
  "id": "my_agent",
  "name": "My Agent",
  "tools": {
    "included": ["read_data_file", "write_data_file", "web_search"],
    "excluded": []
  }
}
```

### 2. Use Tool Sets

Instead of listing individual tools, use predefined tool sets:

```json
{
  "id": "my_agent",
  "name": "My Agent",
  "tool_set": "agent_builder"
}
```

Available tool sets:
- `basic_data`: Essential data manipulation
- `agent_builder`: Agent creation and management
- `web_researcher`: Web research capabilities
- `full_stack`: All available tools

### 3. Use Categories

Include all tools from specific categories:

```json
{
  "id": "my_agent",
  "name": "My Agent",
  "tool_categories": ["data", "web"]
}
```

## Tool Discovery

### By Category

Browse tools by category in the registry:

```javascript
// Read registry
const registry = JSON.parse(readFile('tools/registry.json'));

// Get all data tools
const dataTools = registry.categories.data.tools;
```

### By Tag

Find tools by tag:

```javascript
// Get all tools with 'search' tag
const searchTools = registry.tag_index.search;
// Returns: ["search_global_patterns", "web_search"]
```

### By Name

Search for tools by name or description:

```javascript
// Search in registry
const results = searchTools('budget tracking');
```

## Tool Usage Patterns

### Pattern 1: Data Pipeline

```javascript
// 1. List available data
const files = list_data_files({ folder: "data/finance" });

// 2. Read specific file
const data = read_data_file({ path: "data/finance/budget.json" });

// 3. Process and write back
const processed = processData(data);
write_data_file({ 
  path: "data/finance/budget-analyzed.json",
  content: JSON.stringify(processed)
});
```

### Pattern 2: Agent Coordination

```javascript
// 1. Create specialized agent
upsert_agent({
  id: "data_analyzer",
  slug: "analytics:data_analyzer",
  name: "Data Analyzer",
  domain: "analytics",
  provider: "claude_agents",
  model: "claude-sonnet-4-20250514",
  prompt_file: "data/prompts/analytics/analyzer.md"
});

// 2. Create task for agent
upsert_task({
  id: "analyze-trends",
  agent: "data_analyzer",
  title: "Analyze Trends",
  description: "Analyze data trends and patterns"
});

// 3. Execute task
const result = execute_agent_task({
  agent_name: "data_analyzer",
  task_name: "analyze-trends"
});
```

### Pattern 3: Research Workflow

```javascript
// 1. Search for information
const results = web_search({ 
  query: "best practices for budget tracking",
  num_results: 5
});

// 2. Fetch detailed content
const content = web_fetch({ 
  url: results[0].url 
});

// 3. Store findings
write_data_file({
  path: "research/budget-practices.md",
  content: content
});
```

### Pattern 4: Time-Aware Operations

```javascript
// Get current time for logging
const now = get_current_time();

// Create timestamped entry
write_data_file({
  path: `logs/operation-${now}.json`,
  content: JSON.stringify({
    timestamp: now,
    operation: "data_analysis",
    status: "completed"
  })
});
```

## Advanced Usage

### Conditional Tool Loading

Load tools based on agent capabilities:

```json
{
  "id": "adaptive_agent",
  "name": "Adaptive Agent",
  "tools": {
    "base": ["read_data_file", "write_data_file"],
    "conditional": {
      "if_capability": {
        "web_access": ["web_search", "web_fetch"],
        "agent_coordination": ["execute_agent_task"]
      }
    }
  }
}
```

### Tool Composition

Combine tools for complex operations:

```javascript
// Composite operation: Research and store
async function researchAndStore(topic, outputPath) {
  // Search
  const results = await web_search({ query: topic });
  
  // Fetch top results
  const contents = await Promise.all(
    results.slice(0, 3).map(r => web_fetch({ url: r.url }))
  );
  
  // Combine and store
  const combined = {
    topic,
    timestamp: get_current_time(),
    sources: results.map(r => r.url),
    content: contents.join('\n\n---\n\n')
  };
  
  await write_data_file({
    path: outputPath,
    content: JSON.stringify(combined, null, 2)
  });
}
```

### Error Handling

```javascript
try {
  const data = read_data_file({ path: "data/config.json" });
} catch (error) {
  if (error.code === 'FILE_NOT_FOUND') {
    // Create default config
    write_data_file({
      path: "data/config.json",
      content: JSON.stringify(defaultConfig)
    });
  }
}
```

## Tool Development

### Creating a New Tool

1. **Define the tool** in appropriate category folder:

```json
{
  "id": "my_new_tool",
  "name": "My New Tool",
  "description": "What it does and when to use it",
  "category": "data",
  "function_name": "my_new_tool",
  "parameters": {
    "type": "object",
    "required": ["param1"],
    "properties": {
      "param1": {
        "type": "string",
        "description": "Parameter description"
      }
    }
  },
  "examples": [
    {
      "scenario": "Example usage",
      "parameters": { "param1": "value" },
      "expected_result": "What happens"
    }
  ],
  "tags": ["relevant", "tags"],
  "version": "1.0.0",
  "dependencies": []
}
```

2. **Update registry.json** with the new tool

3. **Test thoroughly** with multiple agents

4. **Document** usage patterns and examples

### Tool Versioning Strategy

- **1.0.0**: Initial release
- **1.1.0**: Add optional parameter (backward compatible)
- **1.0.1**: Fix bug in validation
- **2.0.0**: Change required parameters (breaking change)

## Best Practices

### 1. Use Appropriate Tool Sets

Don't give agents more tools than they need:
- ✅ Use `basic_data` for simple file operations
- ❌ Don't use `full_stack` unless truly needed

### 2. Handle Errors Gracefully

Always check for errors and provide fallbacks:

```javascript
const files = list_data_files({ folder: "data/finance" });
if (!files || files.length === 0) {
  // Handle empty case
}
```

### 3. Document Tool Usage

In agent prompts, explain which tools to use when:

```markdown
## Available Tools

- Use `read_data_file` to access existing configurations
- Use `web_search` only when information is not available locally
- Use `execute_agent_task` to delegate specialized work
```

### 4. Validate Parameters

Always validate parameters before calling tools:

```javascript
if (!path || typeof path !== 'string') {
  throw new Error('Invalid path parameter');
}
```

### 5. Use Tool Dependencies

If a tool depends on others, document it:

```json
{
  "id": "complex_tool",
  "dependencies": ["read_data_file", "write_data_file"]
}
```

## Troubleshooting

### Tool Not Found

```
Error: Tool 'my_tool' not found
```

**Solution**: Check tool ID in registry.json and ensure it's spelled correctly.

### Invalid Parameters

```
Error: Missing required parameter 'path'
```

**Solution**: Review tool definition and provide all required parameters.

### Permission Denied

```
Error: Cannot write to path 'system/config.json'
```

**Solution**: Ensure path is within allowed directories (data/).

## Performance Tips

1. **Batch Operations**: Use `list_data_files` once, then read multiple files
2. **Cache Results**: Store web_search results to avoid repeated calls
3. **Lazy Loading**: Only load tools when needed
4. **Parallel Execution**: Use Promise.all for independent tool calls

## Security Considerations

1. **Path Validation**: Always validate file paths to prevent directory traversal
2. **URL Validation**: Validate URLs before fetching
3. **Input Sanitization**: Sanitize user input before passing to tools
4. **Rate Limiting**: Implement rate limits for web tools
5. **Access Control**: Restrict sensitive tools to authorized agents

## Examples by Use Case

### Use Case: Budget Tracker

```json
{
  "id": "budget_tracker",
  "tool_set": "basic_data",
  "additional_tools": ["get_current_time"]
}
```

### Use Case: Research Assistant

```json
{
  "id": "research_assistant",
  "tool_set": "web_researcher",
  "additional_tools": ["write_data_file"]
}
```

### Use Case: System Builder

```json
{
  "id": "system_builder",
  "tool_set": "agent_builder",
  "additional_tools": ["search_global_patterns"]
}
```

## Further Reading

- [Tool Schema Documentation](schema.json)
- [Tool Registry](registry.json)
- [Contributing Guide](README.md#contributing)
