# Delete Space

## Description

Delete a space and all its data permanently. This removes all agents, tasks, tables, storage files, and metadata associated with the space. Use with caution - this operation cannot be undone.

## Purpose and Use Cases

- **Primary use**: Permanently remove a workspace and all its contents
- **Integration**: Works with space management tools
- **Requirements**: Needs dataDir, globalDir
- **Warning**: This operation is irreversible and destructive

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `space_name` | string | Name of the space to delete (lowercase, alphanumeric, underscores, hyphens) |
| `confirm` | boolean | Must be set to true to confirm deletion |

## Output Format

```typescript
{
  success: boolean;
  space_name: string;
  message: string;
  deleted_at: string;
}
```

## Example Usage

```typescript
import deleteSpace from './implementation'

// Delete a space (requires explicit confirmation)
const result = await deleteSpace(
  {
    space_name: 'old-project',
    confirm: true
  },
  dataDir,
  globalDir
)

console.log(result.message)
// "Space 'old-project' and all its data have been permanently deleted"

console.log(`Deleted at: ${result.deleted_at}`)
```

## Safety Mechanisms

### Confirmation Required

The function requires explicit confirmation to prevent accidental deletion:

```typescript
// This will throw an error
await deleteSpace(
  {
    space_name: 'my-space',
    confirm: false  // Not confirmed
  },
  dataDir,
  globalDir
)
// Error: "Deletion not confirmed. Set confirm=true to delete the space permanently."

// This will work
await deleteSpace(
  {
    space_name: 'my-space',
    confirm: true  // Explicitly confirmed
  },
  dataDir,
  globalDir
)
```

### Validation Checks

Before deletion, the function validates:
- Space name format is correct
- Space exists in the filesystem
- Confirmation flag is set to true

## What Gets Deleted

When you delete a space, the entire directory tree is removed:

```
data/spaces/[space_name]/
├── agents/          # All agent definitions
├── tasks/           # All task files
├── tables/          # All table data
├── storage/         # All storage files
└── space.json       # Space metadata
```

All files and subdirectories are deleted recursively.

## Error Handling

The function throws errors in these cases:

- **Invalid space name**: Name must match pattern `^[a-z0-9_-]+$`
- **Not confirmed**: `confirm` must be `true`
- **Space not found**: Space directory does not exist
- **File system errors**: Cannot delete files or directories

## Best Practices

### Before Deleting

1. **Backup important data**: Use `copy_space` to create a backup
2. **Verify the space name**: Double-check you're deleting the correct space
3. **Check contents**: Use `get_space_info` with `include_contents: true` to see what will be deleted
4. **Consider alternatives**: Maybe you just need to archive instead of delete

### Example Safe Deletion Flow

```typescript
import getSpaceInfo from '../get_space_info/implementation'
import copySpace from '../copy_space/implementation'
import deleteSpace from './implementation'

// 1. Review what will be deleted
const info = await getSpaceInfo(
  {
    space_name: 'old-project',
    include_contents: true
  },
  dataDir,
  globalDir
)

console.log('About to delete:')
console.log(`- ${info.stats.agent_count} agents`)
console.log(`- ${info.stats.task_count} tasks`)
console.log(`- ${info.stats.table_count} tables`)
console.log(`- ${info.stats.storage_files} files`)

// 2. Create backup first
await copySpace(
  {
    source_space: 'old-project',
    destination_space: 'old-project-backup'
  },
  dataDir,
  globalDir
)

console.log('Backup created')

// 3. Now safe to delete
const result = await deleteSpace(
  {
    space_name: 'old-project',
    confirm: true
  },
  dataDir,
  globalDir
)

console.log(result.message)
```

## Recovery

**Important**: There is no built-in recovery mechanism. Once deleted, the data is permanently removed from the filesystem.

If you need to preserve the ability to recover:
- Create backups before deletion using `copy_space`
- Implement your own archival system
- Use filesystem snapshots or version control

## Performance Considerations

- Deletion speed depends on the number of files in the space
- Large spaces with many files may take longer to delete
- The operation is atomic - either all files are deleted or none are

## Validation Rules

- Space name must be lowercase
- Only alphanumeric characters, underscores, and hyphens allowed
- No spaces or special characters
- Must not be empty
- Space must exist
- Confirmation must be explicitly set to `true`

## Related Tools

- `create_space` - Create a new space
- `list_spaces` - List all available spaces
- `get_space_info` - Get detailed information about a space (recommended before deletion)
- `copy_space` - Copy space data (recommended for backups before deletion)
