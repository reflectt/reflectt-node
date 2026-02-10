# Tools Index

Complete reference of all available tools in the system.

## Quick Reference

| Tool ID | Category | Description | Version |
|---------|----------|-------------|---------|
| read_data_file | data | Read JSON/MD files from data/ | 1.0.0 |
| write_data_file | data | Write/update files in data/ | 1.0.0 |
| list_data_files | data | List files in data/ subfolders | 1.0.0 |
| load_agent | agent | Load agent definition by name | 1.0.0 |
| execute_agent_task | agent | Delegate tasks to other agents | 1.0.0 |
| search_global_patterns | agent | Find proven patterns/templates | 1.0.0 |
| upsert_agent | agent | Create/update agent configs | 1.0.0 |
| upsert_task | agent | Create/update task definitions | 1.0.0 |
| web_search | web | Search the web for information | 1.0.0 |
| web_fetch | web | Fetch content from URLs | 1.0.0 |
| get_current_time | time | Get current date and time | 1.0.0 |

## By Category

### Data Tools (3 tools)

#### read_data_file
- **Purpose**: Read JSON or MD files from the data/ folder
- **When to use**: Accessing existing configurations, prompts, or documentation
- **Parameters**: `path` (required)
- **Example**: `read_data_file({ path: "agents/finance/tracker.json" })`
- **Tags**: file, read, json, markdown, config

#### write_data_file
- **Purpose**: Write or update files in the data/ folder
- **When to use**: Creating or modifying configurations, prompts, or documentation
- **Parameters**: `path` (required), `content` (required)
- **Example**: `write_data_file({ path: "tasks/new-task.json", content: "{...}" })`
- **Tags**: file, write, create, update, json, markdown

#### list_data_files
- **Purpose**: List files in data/ subfolders
- **When to use**: Discovering what files exist or understanding structure
- **Parameters**: `folder` (required)
- **Example**: `list_data_files({ folder: "agents" })`
- **Tags**: file, list, directory, discover

---

### Agent Tools (5 tools)

#### load_agent
- **Purpose**: Load an agent definition by name with hierarchical search
- **When to use**: Inspecting agent configurations, loading sub-agents, or preparing agents for execution
- **Parameters**: `agent_name` (required), `search_space` (optional), `search_global` (optional)
- **Example**: `load_agent({ agent_name: "student_tutor" })`
- **Tags**: agent, load, hierarchical, discovery

#### execute_agent_task
- **Purpose**: Delegate a task to another agent
- **When to use**: Breaking down complex work or coordinating between agents
- **Parameters**: `agent_name` (required), `task_name` (required)
- **Example**: `execute_agent_task({ agent_name: "data_analyst", task_name: "analyze-trends" })`
- **Tags**: agent, task, delegate, coordination, workflow

#### search_global_patterns
- **Purpose**: Search for proven patterns and templates
- **When to use**: Finding existing solutions before building from scratch
- **Parameters**: `domain` (required), `keywords` (optional)
- **Example**: `search_global_patterns({ domain: "finance", keywords: ["budget", "tracking"] })`
- **Tags**: patterns, templates, best-practices, reuse, search

#### upsert_agent
- **Purpose**: Create or update an agent configuration
- **When to use**: Defining new agents or modifying existing ones
- **Parameters**: `id`, `slug`, `name`, `domain`, `provider`, `model`, `prompt_file` (all required)
- **Example**: `upsert_agent({ id: "tracker", slug: "finance:tracker", ... })`
- **Tags**: agent, create, update, configuration, schema

#### upsert_task
- **Purpose**: Create or update a task definition
- **When to use**: Defining what an agent can do
- **Parameters**: `id`, `agent`, `title`, `description` (all required)
- **Example**: `upsert_task({ id: "analyze", agent: "tracker", title: "Analyze Budget", ... })`
- **Tags**: task, create, update, configuration, schema

---

### Web Tools (2 tools)

#### web_search
- **Purpose**: Search the web for information
- **When to use**: Finding current information or researching topics
- **Parameters**: `query` (required), `num_results` (optional, default: 5)
- **Example**: `web_search({ query: "budget tracking best practices", num_results: 5 })`
- **Tags**: web, search, research, internet, information

#### web_fetch
- **Purpose**: Fetch content from a web page
- **When to use**: Getting detailed information from specific URLs
- **Parameters**: `url` (required)
- **Example**: `web_fetch({ url: "https://example.com/docs" })`
- **Tags**: web, fetch, scrape, content, url

---

### Time Tools (1 tool)

#### get_current_time
- **Purpose**: Get the current date and time
- **When to use**: Time-sensitive operations, scheduling, or logging
- **Parameters**: None
- **Example**: `get_current_time()`
- **Tags**: time, date, timestamp, now, current

---

## By Use Case

### File Management
- `read_data_file` - Read files
- `write_data_file` - Write files
- `list_data_files` - List files

### Agent Development
- `load_agent` - Load agent definitions
- `upsert_agent` - Create agents
- `upsert_task` - Create tasks
- `search_global_patterns` - Find patterns

### Agent Coordination
- `load_agent` - Inspect agents
- `execute_agent_task` - Delegate work
- `search_global_patterns` - Share knowledge

### Research & Information
- `web_search` - Find information
- `web_fetch` - Get details
- `read_data_file` - Access local data

### System Operations
- `get_current_time` - Timestamps
- `write_data_file` - Logging
- `list_data_files` - Discovery

---

## By Tag

### Configuration & Setup
- **config**: read_data_file
- **configuration**: upsert_agent, upsert_task
- **schema**: upsert_agent, upsert_task

### Data Operations
- **read**: read_data_file
- **write**: write_data_file
- **create**: write_data_file, upsert_agent, upsert_task
- **update**: write_data_file, upsert_agent, upsert_task
- **list**: list_data_files

### Agent Operations
- **agent**: load_agent, execute_agent_task, upsert_agent
- **load**: load_agent
- **task**: execute_agent_task, upsert_task
- **delegate**: execute_agent_task
- **coordination**: execute_agent_task
- **workflow**: execute_agent_task
- **hierarchical**: load_agent

### Discovery & Search
- **discover**: list_data_files, load_agent
- **discovery**: load_agent
- **search**: search_global_patterns, web_search
- **patterns**: search_global_patterns
- **templates**: search_global_patterns

### Web & Internet
- **web**: web_search, web_fetch
- **internet**: web_search
- **research**: web_search
- **fetch**: web_fetch
- **url**: web_fetch

### Time Operations
- **time**: get_current_time
- **date**: get_current_time
- **timestamp**: get_current_time
- **now**: get_current_time

---

## Tool Sets

### basic_data
Essential data manipulation tools
- read_data_file
- write_data_file
- list_data_files

### agent_builder
Tools for building and managing agents
- load_agent
- upsert_agent
- upsert_task
- read_data_file
- write_data_file

### web_researcher
Tools for web research
- web_search
- web_fetch

### full_stack
All available tools (11 tools)

---

## Tool Dependencies

### No Dependencies
All current tools are self-contained with no dependencies.

### Future Considerations
When adding tools with dependencies, document them here:
- Tool A depends on Tool B
- Tool C requires Tool D and Tool E

---

## Version History

### 1.0.1 (Current)
- 11 tools across 4 categories
- Added load_agent tool for hierarchical agent loading
- Complete schema and validation
- Registry and documentation
- Tool sets and tag indexing

### 1.0.0 (Initial Release)
- 10 tools across 4 categories
- Complete schema and validation
- Registry and documentation
- Tool sets and tag indexing

---

## Quick Start Examples

### Example 1: Read and Process Data
```javascript
// List available files
const files = list_data_files({ folder: "data/finance" });

// Read specific file
const data = read_data_file({ path: files[0] });

// Process and save
write_data_file({ 
  path: "data/finance/processed.json", 
  content: JSON.stringify(processedData) 
});
```

### Example 2: Create an Agent System
```javascript
// Load existing agent for reference
const template = load_agent({ agent_name: "base_agent" });

// Create agent
upsert_agent({
  id: "analyzer",
  slug: "analytics:analyzer",
  name: "Data Analyzer",
  domain: "analytics",
  provider: "claude_agents",
  model: "claude-sonnet-4-20250514",
  prompt_file: "data/prompts/analyzer.md"
});

// Create task
upsert_task({
  id: "analyze-trends",
  agent: "analyzer",
  title: "Analyze Trends",
  description: "Analyze data trends"
});

// Execute task
execute_agent_task({
  agent_name: "analyzer",
  task_name: "analyze-trends"
});
```

### Example 3: Research Workflow
```javascript
// Search for information
const results = web_search({ 
  query: "machine learning best practices",
  num_results: 3
});

// Fetch detailed content
const content = web_fetch({ url: results[0].url });

// Save research
write_data_file({
  path: "research/ml-practices.md",
  content: content
});
```

---

## See Also

- [README.md](README.md) - Overview and structure
- [USAGE_GUIDE.md](USAGE_GUIDE.md) - Detailed usage patterns
- [schema.json](schema.json) - Tool definition schema
- [registry.json](registry.json) - Complete tool registry
- [loader.json](loader.json) - Tool loading configuration
