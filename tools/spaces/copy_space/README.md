# Copy Space

## Description

Copy all data from one space to another. Creates the destination space if it doesn't exist. Copies all agents, tasks, tables (with schemas and rows), storage files, and metadata. Useful for creating backups, templates, or duplicating environments.

## Purpose and Use Cases

- **Primary use**: Duplicate workspace environments
- **Integration**: Works with space management tools
- **Requirements**: Needs dataDir, globalDir
- **Use cases**: Backups, templates, environment duplication, migration

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source_space` | string | Name of the source space to copy from |
| `destination_space` | string | Name of the destination space to copy to |

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `overwrite` | boolean | false | Whether to overwrite existing files in destination space |
| `include_agents` | boolean | true | Copy agents |
| `include_tasks` | boolean | true | Copy tasks |
| `include_tables` | boolean | true | Copy tables and data |
| `include_storage` | boolean | true | Copy storage files |

## Output Format

```typescript
{
  success: boolean;
  source_space: string;
  destination_space: string;
  message: string;
  copied_at: string;
  stats: {
    agents_copied: number;
    tasks_copied: number;
    tables_copied: number;
    storage_files_copied: number;
  };
}
```

## Example Usage

```typescript
import copySpace from './implementation'

// Full copy
const result = await copySpace(
  {
    source_space: 'production',
    destination_space: 'production-backup'
  },
  dataDir,
  globalDir
)

console.log(result.message)
console.log(`Agents copied: ${result.stats.agents_copied}`)
console.log(`Tasks copied: ${result.stats.tasks_copied}`)
console.log(`Tables copied: ${result.stats.tables_copied}`)
console.log(`Files copied: ${result.stats.storage_files_copied}`)

// Selective copy (only agents and tasks)
const selectiveCopy = await copySpace(
  {
    source_space: 'project-a',
    destination_space: 'project-b',
    include_agents: true,
    include_tasks: true,
    include_tables: false,
    include_storage: false
  },
  dataDir,
  globalDir
)

// Copy with overwrite
const overwriteCopy = await copySpace(
  {
    source_space: 'production',
    destination_space: 'staging',
    overwrite: true  // Overwrites existing files
  },
  dataDir,
  globalDir
)
```

## Selective Copying

You can choose which components to copy:

```typescript
// Only copy agents and storage files
await copySpace(
  {
    source_space: 'old-space',
    destination_space: 'new-space',
    include_agents: true,
    include_tasks: false,
    include_tables: false,
    include_storage: true
  },
  dataDir,
  globalDir
)
```

## Overwrite Behavior

### Default (overwrite: false)

- Existing files in destination are **not** overwritten
- New files are copied normally
- Stats reflect only newly copied files

### With overwrite: true

- All files are copied, replacing existing ones
- Useful for syncing or updating
- Stats reflect all copied files

```typescript
// Safe copy - preserves existing files
await copySpace(
  {
    source_space: 'source',
    destination_space: 'dest',
    overwrite: false  // Skip existing files
  },
  dataDir,
  globalDir
)

// Full sync - replaces everything
await copySpace(
  {
    source_space: 'source',
    destination_space: 'dest',
    overwrite: true  // Replace all files
  },
  dataDir,
  globalDir
)
```

## Metadata Handling

When copying a space, the metadata file is updated:

```json
{
  "space_name": "destination-space",
  "description": "...",
  "created_at": "2025-10-17T12:00:00.000Z",  // New timestamp
  "updated_at": "2025-10-17T12:00:00.000Z",
  "metadata": {
    "copied_from": "source-space",
    "copied_at": "2025-10-17T12:00:00.000Z",
    "...other metadata from source..."
  }
}
```

The destination space gets:
- New `created_at` timestamp
- New `updated_at` timestamp
- `copied_from` and `copied_at` in metadata
- All other metadata from source is preserved

## Error Handling

The function throws errors in these cases:

- **Invalid source space name**: Must match pattern `^[a-z0-9_-]+$`
- **Invalid destination space name**: Must match pattern `^[a-z0-9_-]+$`
- **Source not found**: Source space directory does not exist
- **Destination exists**: Destination exists and `overwrite: false`
- **File system errors**: Cannot read source or write to destination

## Common Use Cases

### 1. Create Backup

```typescript
import copySpace from './implementation'

await copySpace(
  {
    source_space: 'production',
    destination_space: 'production-backup-2025-10-17'
  },
  dataDir,
  globalDir
)
```

### 2. Create Template

```typescript
// Copy structure without data
await copySpace(
  {
    source_space: 'template',
    destination_space: 'new-project',
    include_agents: true,
    include_tasks: true,
    include_tables: false,  // Don't copy data
    include_storage: false
  },
  dataDir,
  globalDir
)
```

### 3. Sync Environments

```typescript
// Sync staging from production
await copySpace(
  {
    source_space: 'production',
    destination_space: 'staging',
    overwrite: true  // Replace all files
  },
  dataDir,
  globalDir
)
```

### 4. Migration

```typescript
// Migrate to new space name
await copySpace(
  {
    source_space: 'old-project-name',
    destination_space: 'new-project-name'
  },
  dataDir,
  globalDir
)

// Then optionally delete old space
```

## Performance Considerations

- Copy speed depends on number and size of files
- Large spaces with many files take longer
- Selective copying (`include_*: false`) is faster
- Use `overwrite: false` to skip existing files (faster)

## Directory Structure

What gets copied:

```
source_space/
├── agents/          → destination_space/agents/
├── tasks/           → destination_space/tasks/
├── tables/          → destination_space/tables/
├── storage/         → destination_space/storage/
└── space.json       → destination_space/space.json (updated)
```

## Best Practices

### Before Copying

1. **Verify source exists**: Use `get_space_info` to check source
2. **Check destination**: Use `list_spaces` to verify destination name is available
3. **Estimate size**: Use `get_space_info` with stats to see how much will be copied

### After Copying

1. **Verify stats**: Check returned stats match expectations
2. **Validate destination**: Use `get_space_info` on destination to verify
3. **Update metadata**: Add custom metadata to destination if needed

### Example Safe Copy Flow

```typescript
import getSpaceInfo from '../get_space_info/implementation'
import copySpace from './implementation'

// 1. Check source
const sourceInfo = await getSpaceInfo(
  { space_name: 'production' },
  dataDir,
  globalDir
)

console.log(`Copying ${sourceInfo.stats.storage_files} files...`)

// 2. Perform copy
const result = await copySpace(
  {
    source_space: 'production',
    destination_space: 'backup-2025-10-17'
  },
  dataDir,
  globalDir
)

// 3. Verify
const destInfo = await getSpaceInfo(
  { space_name: 'backup-2025-10-17' },
  dataDir,
  globalDir
)

console.log(`Backup created: ${destInfo.stats.storage_files} files`)
```

## Validation Rules

- Source and destination space names must be lowercase
- Only alphanumeric characters, underscores, and hyphens allowed
- No spaces or special characters
- Must not be empty
- Source must exist
- If destination exists, must set `overwrite: true`

## Related Tools

- `create_space` - Create a new space
- `list_spaces` - List all available spaces
- `get_space_info` - Get detailed information about a space
- `delete_space` - Delete a space permanently
