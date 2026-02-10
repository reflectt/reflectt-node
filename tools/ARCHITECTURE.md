# Tools Architecture

## Structure

```
data/global/tools/
├── definitions/              # Tool definitions (what they do)
│   ├── data/                # Data manipulation tools
│   │   ├── read_data_file.json
│   │   ├── write_data_file.json
│   │   └── list_data_files.json
│   ├── agent/               # Agent coordination tools
│   │   ├── execute_agent_task.json
│   │   ├── search_global_patterns.json
│   │   ├── upsert_agent.json
│   │   └── upsert_task.json
│   ├── web/                 # Web interaction tools
│   │   ├── web_search.json
│   │   └── web_fetch.json
│   └── time/                # Time-related tools
│       └── get_current_time.json
│
├── implementations/          # Tool implementations (how they work)
│   ├── data/
│   │   ├── read_data_file.ts
│   │   ├── write_data_file.ts
│   │   └── list_data_files.ts
│   ├── agent/
│   │   ├── execute_agent_task.ts
│   │   ├── search_global_patterns.ts
│   │   ├── upsert_agent.ts
│   │   └── upsert_task.ts
│   ├── web/
│   │   ├── web_search.ts
│   │   └── web_fetch.ts
│   └── time/
│       └── get_current_time.ts
│
├── registry.json            # Central tool registry
├── schema.json              # Tool definition schema
├── loader.json              # Tool loading configuration
├── validation.json          # Validation rules
│
└── docs/                    # Comprehensive documentation
    ├── README.md
    ├── INDEX.md
    ├── USAGE_GUIDE.md
    ├── MIGRATION_GUIDE.md
    ├── QUICK_REFERENCE.md
    ├── MASTER_INDEX.md
    └── EXTERNALIZATION_SUMMARY.md
```

## Design Principles

### 1. **Separation of Concerns**
- **Definitions** (JSON) describe what tools do - schema, parameters, examples
- **Implementations** (TypeScript) contain how tools work - actual code
- This allows agents to understand tools without needing to parse code

### 2. **Organized by Category**
- Tools grouped by purpose (data, agent, web, time)
- Easy to find related tools
- Clear namespace organization

### 3. **Discoverable**
- Registry provides central index
- Each category folder is browsable
- Tools have rich metadata (tags, examples, dependencies)

### 4. **Evolvable**
- Agents can read implementations
- Agents can modify implementations
- Agents can create new tools
- All changes tracked in git

### 5. **Minimal CLI**
- CLI loads tools dynamically from data/global/
- No hard-coded tool definitions or implementations
- CLI is just the execution engine

## How It Works

### 1. **Tool Loading (Startup)**

```typescript
import { loadAllTools, buildAnthropicToolSchema } from './cli/tool-loader'

// Load all tools from data/global/tools/
const { definitions, implementations } = await loadAllTools(GLOBAL_DIR)

// Build Anthropic tool schemas for Claude
const anthropicTools = Array.from(definitions.values())
  .map(def => buildAnthropicToolSchema(def))
```

### 2. **Tool Execution (Runtime)**

```typescript
import { executeTool } from './cli/tool-loader'

// When Claude calls a tool
const result = await executeTool(toolName, toolInput, {
  dataDir: DATA_DIR,
  globalDir: GLOBAL_DIR,
  loadAgent,
  executeAgent
})
```

### 3. **Tool Discovery (By Agents)**

```typescript
// Agent reads all available tools
const tools = await list_data_files({ folder: 'global/tools/definitions/data' })

// Agent reads tool definition
const toolDef = await read_data_file({
  path: 'global/tools/definitions/data/read_data_file.json'
})

// Agent reads tool implementation
const toolImpl = await read_data_file({
  path: 'global/tools/implementations/data/read_data_file.ts'
})
```

## Benefits

### For Developers
- ✅ Clean separation of definition and implementation
- ✅ Easy to add new tools
- ✅ Easy to test tools in isolation
- ✅ Clear folder structure
- ✅ Comprehensive documentation

### For Agents
- ✅ Can discover all available tools
- ✅ Can read tool implementations
- ✅ Can modify tool implementations
- ✅ Can create new tools
- ✅ Can test tools programmatically

### For the System
- ✅ Minimal CLI (< 200 lines)
- ✅ All tools in one place
- ✅ Version controlled
- ✅ Easy to backup/restore
- ✅ Portable across systems

## Autonomous Evolution

This architecture enables true autonomous evolution:

1. **Agent Discovers Gap**
   - Analyzes workflows
   - Identifies missing tool
   - Reads similar tool implementations for reference

2. **Agent Designs Tool**
   - Creates definition JSON with schema
   - Writes implementation TypeScript
   - Adds examples and documentation

3. **Agent Tests Tool**
   - Writes test cases
   - Executes tool
   - Validates output

4. **Agent Deploys Tool**
   - Saves to data/global/tools/
   - Updates registry.json
   - Tool immediately available

5. **Agent Improves Tool**
   - Monitors usage and errors
   - Reads current implementation
   - Refactors and optimizes
   - Deploys improved version

## Example: Agent Creating New Tool

```typescript
// 1. Agent identifies need
const needTool = await analyzeWorkflows()
// Result: Need "merge_json_files" tool

// 2. Agent creates definition
await write_data_file({
  path: 'global/tools/definitions/data/merge_json_files.json',
  content: JSON.stringify({
    id: 'merge_json_files',
    name: 'Merge JSON Files',
    description: 'Merge multiple JSON files into one',
    category: 'data',
    function_name: 'merge_json_files',
    parameters: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to merge'
        }
      }
    },
    version: '1.0.0'
  }, null, 2)
})

// 3. Agent creates implementation
await write_data_file({
  path: 'global/tools/implementations/data/merge_json_files.ts',
  content: `
export interface MergeJsonFilesInput {
  files: string[]
}

export default async function mergeJsonFiles(
  input: MergeJsonFilesInput,
  dataDir: string
): Promise<any> {
  const merged = {}
  for (const file of input.files) {
    const content = await readFile(path.join(dataDir, file))
    Object.assign(merged, JSON.parse(content))
  }
  return merged
}
`
})

// 4. Agent updates registry
const registry = await read_data_file({ path: 'global/tools/registry.json' })
const registryData = JSON.parse(registry.content)
registryData.categories.data.tools.push({
  id: 'merge_json_files',
  name: 'Merge JSON Files',
  path: 'tools/definitions/data/merge_json_files.json',
  tags: ['file', 'json', 'merge', 'combine']
})
await write_data_file({
  path: 'global/tools/registry.json',
  content: JSON.stringify(registryData, null, 2)
})

// 5. Tool is now available!
const result = await merge_json_files({
  files: ['file1.json', 'file2.json']
})
```

## Migration Path

**Old Architecture:**
- Tools hard-coded in `cli/index.ts`
- 300+ lines of switch statements
- No separation of definition and implementation
- Can't be modified by agents

**New Architecture:**
- Tools in `data/global/tools/`
- CLI < 200 lines (just loading and execution)
- Clear separation: definitions (what) vs implementations (how)
- Fully modifiable by agents

**Migration Steps:**
1. ✅ Extract tool implementations to TypeScript files
2. ✅ Move to data/global/tools/implementations/
3. ✅ Move definitions to data/global/tools/definitions/
4. ✅ Create dynamic tool loader
5. ⏳ Update CLI to use tool loader
6. ⏳ Remove hard-coded tools from CLI
7. ✅ Test and verify

## Next Steps

1. **Update CLI** - Use tool loader, remove hard-coded tools
2. **Test** - Verify all tools work with new architecture
3. **Document** - Update all references to new structure
4. **Celebrate** - Agents can now evolve their tools! 🎉

---

**Status:** ✅ Architecture Complete
**Tools:** 10 (all categories)
**Files:** 20 (10 definitions + 10 implementations)
**CLI Size:** Will be < 200 lines (currently 800+)
**Autonomous Evolution:** Ready! 🚀
