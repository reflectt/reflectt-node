# Tools Quick Reference Card

## Tool Categories

| Category | Count | Purpose |
|----------|-------|---------|
| **data** | 3 | File operations |
| **agent** | 5 | Agent management |
| **web** | 2 | Web interaction |
| **time** | 1 | Time operations |

## All Tools at a Glance

### Data Tools
```
read_data_file      → Read files from data/
write_data_file     → Write files to data/
list_data_files     → List files in data/
```

### Agent Tools
```
load_agent              → Load agent definition
execute_agent_task      → Delegate to another agent
search_global_patterns  → Find patterns/templates
upsert_agent           → Create/update agent
upsert_task            → Create/update task
```

### Web Tools
```
web_search  → Search the web
web_fetch   → Fetch URL content
```

### Time Tools
```
get_current_time  → Get current date/time
```

## Tool Sets

```
basic_data      → read, write, list (3 tools)
agent_builder   → load, agent/task creation + data (5 tools)
web_researcher  → search, fetch (2 tools)
full_stack      → all tools (11 tools)
```

## Usage Patterns

### In Agent Config

**Use a tool set:**
```json
{ "tool_set": "basic_data" }
```

**List specific tools:**
```json
{ "tools": ["read_data_file", "web_search"] }
```

**Use categories:**
```json
{ "tool_categories": ["data", "web"] }
```

**Combine approaches:**
```json
{
  "tool_set": "basic_data",
  "additional_tools": ["web_search"]
}
```

## Common Operations

### Read File
```javascript
read_data_file({ path: "agents/my-agent.json" })
```

### Write File
```javascript
write_data_file({ 
  path: "data/output.json",
  content: JSON.stringify(data)
})
```

### List Files
```javascript
list_data_files({ folder: "agents" })
```

### Load Agent
```javascript
load_agent({ agent_name: "student_tutor" })
```

### Search Web
```javascript
web_search({ 
  query: "search terms",
  num_results: 5
})
```

### Fetch URL
```javascript
web_fetch({ url: "https://example.com" })
```

### Get Time
```javascript
get_current_time()
```

### Create Agent
```javascript
upsert_agent({
  id: "my_agent",
  slug: "domain:my_agent",
  name: "My Agent",
  domain: "domain",
  provider: "claude_agents",
  model: "claude-sonnet-4-20250514",
  prompt_file: "data/prompts/my-agent.md"
})
```

### Create Task
```javascript
upsert_task({
  id: "my-task",
  agent: "my_agent",
  title: "My Task",
  description: "Task description"
})
```

### Execute Task
```javascript
execute_agent_task({
  agent_name: "my_agent",
  task_name: "my-task"
})
```

### Search Patterns
```javascript
search_global_patterns({
  domain: "finance",
  keywords: ["budget", "tracking"]
})
```

## File Locations

```
tools/
├── INDEX.md              → Full tool reference
├── USAGE_GUIDE.md        → Detailed usage
├── MIGRATION_GUIDE.md    → Migration help
├── README.md             → Overview
├── registry.json         → Tool registry
├── schema.json           → Tool schema
├── definitions/
│   ├── data/             → Data tools
│   ├── agent/            → Agent tools
│   ├── web/              → Web tools
│   └── time/             → Time tools
└── implementations/      → Tool implementations
```

## Tag Index

**File Operations**: file, read, write, list, create, update  
**Agent Operations**: agent, load, task, delegate, coordination, hierarchical  
**Discovery**: discover, discovery, search, patterns, templates  
**Web**: web, internet, research, fetch, url  
**Time**: time, date, timestamp, now  
**Config**: config, configuration, schema

## Quick Decisions

**Need to read/write files?**  
→ Use `basic_data` tool set

**Building agents?**  
→ Use `agent_builder` tool set

**Doing research?**  
→ Use `web_researcher` tool set

**Need everything?**  
→ Use `full_stack` tool set

**Need specific tools?**  
→ List them explicitly

## Validation

**Check tool exists:**
```bash
cat data/tools/registry.json | grep "tool_id"
```

**View tool definition:**
```bash
cat data/tools/definitions/category/tool_id.json
```

**Check schema:**
```bash
cat data/tools/schema.json
```

## Common Patterns

### Pattern: Data Pipeline
```
list_data_files → read_data_file → process → write_data_file
```

### Pattern: Agent Creation
```
load_agent → upsert_agent → upsert_task → execute_agent_task
```

### Pattern: Research
```
web_search → web_fetch → write_data_file
```

### Pattern: Time-Stamped Logging
```
get_current_time → write_data_file
```

## Error Handling

**Tool not found:**
- Check spelling
- Verify in registry
- Check agent config

**Missing parameter:**
- Review tool definition
- Check required fields
- Provide all required params

**Invalid path:**
- Must be relative to data/
- Check path exists
- Verify permissions

## Best Practices

✅ **DO:**
- Use tool sets when possible
- Document tool usage in prompts
- Validate parameters
- Handle errors gracefully
- Use minimal tool sets

❌ **DON'T:**
- Give agents unnecessary tools
- Hardcode tool lists
- Ignore validation errors
- Skip error handling
- Use full_stack by default

## Getting Help

1. **Quick lookup**: INDEX.md
2. **Usage patterns**: USAGE_GUIDE.md
3. **Migration**: MIGRATION_GUIDE.md
4. **Tool details**: tools/definitions/category/tool.json
5. **Registry**: registry.json

## Version Info

- **Version**: 1.0.1
- **Total Tools**: 11
- **Categories**: 4
- **Tool Sets**: 4
- **Last Updated**: 2025-01-17

---

**Print this page for quick reference!**
