# Get Space Info

## Description

Get detailed information about a specific space including metadata, creation date, statistics (agent count, task count, table count, storage usage), and directory structure.

## Purpose and Use Cases

- **Primary use**: Get comprehensive information about a specific workspace
- **Integration**: Works with space management tools
- **Requirements**: Needs dataDir, globalDir
- **Use cases**: Space inspection, capacity planning, content inventory

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `space_name` | string | Name of the space to get info about (lowercase, alphanumeric, underscores, hyphens) |

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `include_contents` | boolean | false | Include lists of agents, tasks, and tables in the space |

## Output Format

```typescript
{
  success: boolean;
  space_name: string;
  description: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, any>;
  path: string;
  stats: {
    agent_count: number;
    task_count: number;
    table_count: number;
    storage_files: number;
    total_size_bytes: number;
  };
  contents?: {
    agents: string[];
    tasks: string[];
    tables: string[];
    storage_categories: string[];
  };
}
```

## Example Usage

```typescript
import getSpaceInfo from './implementation'

// Basic info
const result = await getSpaceInfo(
  {
    space_name: 'my-project'
  },
  dataDir,
  globalDir
)

console.log(`Space: ${result.space_name}`)
console.log(`Description: ${result.description}`)
console.log(`Created: ${result.created_at}`)
console.log(`Path: ${result.path}`)
console.log(`Statistics:`)
console.log(`  Agents: ${result.stats.agent_count}`)
console.log(`  Tasks: ${result.stats.task_count}`)
console.log(`  Tables: ${result.stats.table_count}`)
console.log(`  Storage Files: ${result.stats.storage_files}`)
console.log(`  Total Size: ${result.stats.total_size_bytes} bytes`)

// With contents
const detailedResult = await getSpaceInfo(
  {
    space_name: 'my-project',
    include_contents: true
  },
  dataDir,
  globalDir
)

console.log(`\nAgents: ${detailedResult.contents?.agents.join(', ')}`)
console.log(`Tasks: ${detailedResult.contents?.tasks.join(', ')}`)
console.log(`Tables: ${detailedResult.contents?.tables.join(', ')}`)
console.log(`Storage Categories: ${detailedResult.contents?.storage_categories.join(', ')}`)
```

## Statistics

The function always returns statistics including:

- **agent_count**: Number of agent definition files (`.json` files in `agents/`)
- **task_count**: Total number of task files recursively in `tasks/` directory
- **table_count**: Number of table directories in `tables/`
- **storage_files**: Total number of files recursively in `storage/` directory
- **total_size_bytes**: Total size of all files in the space (recursive)

## Contents Detail

When `include_contents: true`, the function includes:

- **agents**: Array of agent names (without `.json` extension)
- **tasks**: Array of task paths in format `agent_name/task_name`
- **tables**: Array of table directory names
- **storage_categories**: Array of top-level directory names in storage

Example:
```typescript
contents: {
  agents: ['sales-agent', 'support-agent'],
  tasks: ['sales-agent/follow-up', 'support-agent/ticket-triage'],
  tables: ['customers', 'products', 'orders'],
  storage_categories: ['images', 'documents', 'exports']
}
```

## Error Handling

The function throws errors in these cases:

- **Invalid space name**: Name must match pattern `^[a-z0-9_-]+$`
- **Space not found**: Space directory does not exist
- **File system errors**: Cannot read space files or directories

## Performance Considerations

- Basic info (without contents) is fast
- Statistics calculation requires recursive file counting
- Contents listing reads directory structures
- For large spaces, use `include_contents: false` for faster response
- Total size calculation traverses entire directory tree

## Metadata Structure

The space metadata file (`space.json`) contains:

```json
{
  "space_name": "my-project",
  "description": "Project workspace",
  "created_at": "2025-10-17T12:00:00.000Z",
  "updated_at": "2025-10-17T12:00:00.000Z",
  "metadata": {
    "owner": "engineering-team",
    "tags": ["production"],
    "custom_field": "value"
  }
}
```

## Validation Rules

- Space name must be lowercase
- Only alphanumeric characters, underscores, and hyphens allowed
- No spaces or special characters
- Must not be empty
- Space must exist

## Related Tools

- `create_space` - Create a new space
- `list_spaces` - List all available spaces
- `delete_space` - Delete a space permanently
- `copy_space` - Copy space data to another space
