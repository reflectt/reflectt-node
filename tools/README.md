# Tools Library

This directory contains externalized tool definitions that agents can use. Each tool is defined in a structured JSON format following the schema in `schema.json`.

## Directory Structure

```
tools/
├── schema.json           # JSON Schema for tool definitions
├── README.md            # This file
├── registry.json        # Central registry of all tools
├── data/                # Data manipulation tools
│   ├── read_data_file.json
│   ├── write_data_file.json
│   └── list_data_files.json
├── agent/               # Agent coordination tools
│   ├── execute_agent_task.json
│   ├── search_global_patterns.json
│   ├── upsert_agent.json
│   └── upsert_task.json
├── web/                 # Web interaction tools
│   ├── web_search.json
│   └── web_fetch.json
└── time/                # Time-related tools
    └── get_current_time.json
```

## Tool Categories

### Data Tools
Tools for reading, writing, and managing data files:
- **read_data_file**: Read JSON or MD files from data/ folder
- **write_data_file**: Write or update files in data/ folder
- **list_data_files**: List files in data/ subfolders

### Agent Tools
Tools for agent coordination and management:
- **execute_agent_task**: Delegate tasks to other agents
- **search_global_patterns**: Find proven patterns and templates
- **upsert_agent**: Create or update agent configurations
- **upsert_task**: Create or update task definitions

### Web Tools
Tools for web interaction:
- **web_search**: Search the web for information
- **web_fetch**: Fetch content from URLs

### Time Tools
Tools for time operations:
- **get_current_time**: Get current date and time

## Using Tools

### In Agent Configurations

Agents can reference tools by their ID or category:

```json
{
  "id": "my_agent",
  "tools": ["read_data_file", "write_data_file", "web_search"],
  "tool_categories": ["data", "web"]
}
```

### Tool Definition Format

Each tool follows this structure:

```json
{
  "id": "tool_id",
  "name": "Human Readable Name",
  "description": "What the tool does",
  "category": "data|agent|web|time|system",
  "function_name": "actual_function_name",
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
  "examples": [...],
  "tags": ["tag1", "tag2"],
  "version": "1.0.0",
  "dependencies": []
}
```

## Adding New Tools

1. Create a new JSON file in the appropriate category folder
2. Follow the schema defined in `schema.json`
3. Add the tool to `registry.json`
4. Include examples and clear documentation
5. Tag appropriately for discoverability

## Best Practices

1. **Clear Descriptions**: Make it obvious when and why to use the tool
2. **Complete Examples**: Show real-world usage scenarios
3. **Proper Categorization**: Use the right category for easy discovery
4. **Version Control**: Use semantic versioning for tool updates
5. **Dependencies**: Document any tool dependencies clearly
6. **Tags**: Add relevant tags for searchability

## Tool Versioning

Tools use semantic versioning (MAJOR.MINOR.PATCH):
- **MAJOR**: Breaking changes to parameters or behavior
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes, backward compatible

## Tool Discovery

Tools can be discovered by:
- **Category**: Browse by category folder
- **Tags**: Search by tags in registry
- **Name/Description**: Full-text search in registry
- **Dependencies**: Find related tools

## Validation

All tools must validate against `schema.json`. Use the validation script:

```bash
npm run validate-tools
```

## Contributing

When adding or modifying tools:
1. Ensure schema compliance
2. Add comprehensive examples
3. Update registry.json
4. Document any breaking changes
5. Test with multiple agents
