# List Spaces

## Description

List all available spaces in the system. Returns space names, descriptions, creation dates, and metadata. Useful for discovering what spaces exist and their purposes.

## Purpose and Use Cases

- **Primary use**: Discover and browse all available workspace environments
- **Integration**: Works with space management tools
- **Requirements**: Needs dataDir, globalDir
- **Use cases**: Space discovery, inventory management, filtering by tags

## Input Parameters

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `include_stats` | boolean | false | Include statistics about each space (agent count, task count, table count, storage size) |
| `filter_tag` | string | - | Optional: Filter spaces by a metadata tag |

## Output Format

```typescript
{
  success: boolean;
  count: number;
  spaces: Array<{
    space_name: string;
    description: string;
    created_at: string;
    updated_at: string;
    metadata: Record<string, any>;
    stats?: {
      agent_count: number;
      task_count: number;
      table_count: number;
      storage_files: number;
    };
  }>;
}
```

## Example Usage

```typescript
import listSpaces from './implementation'

// Basic listing
const result = await listSpaces(
  {},
  dataDir,
  globalDir
)

console.log(`Found ${result.count} spaces`)
result.spaces.forEach(space => {
  console.log(`- ${space.space_name}: ${space.description}`)
})

// With statistics
const resultWithStats = await listSpaces(
  {
    include_stats: true
  },
  dataDir,
  globalDir
)

resultWithStats.spaces.forEach(space => {
  console.log(`${space.space_name}:`)
  console.log(`  Agents: ${space.stats?.agent_count}`)
  console.log(`  Tasks: ${space.stats?.task_count}`)
  console.log(`  Tables: ${space.stats?.table_count}`)
  console.log(`  Files: ${space.stats?.storage_files}`)
})

// Filter by tag
const productionSpaces = await listSpaces(
  {
    filter_tag: 'production'
  },
  dataDir,
  globalDir
)

console.log(`Production spaces: ${productionSpaces.count}`)
```

## Filtering

### By Tag

Spaces can be filtered by metadata tags. Only spaces that have the specified tag in their `metadata.tags` array will be returned.

```typescript
// Only return spaces tagged as 'production'
const result = await listSpaces(
  { filter_tag: 'production' },
  dataDir,
  globalDir
)
```

## Statistics

When `include_stats: true`, each space will include:

- **agent_count**: Number of agent definition files
- **task_count**: Total number of task files (recursive count)
- **table_count**: Number of table directories
- **storage_files**: Total number of files in storage (recursive count)

Note: Calculating statistics may take longer for spaces with many files.

## Error Handling

- **No spaces directory**: Returns empty array with `success: true, count: 0`
- **Invalid metadata files**: Uses defaults and continues
- **Inaccessible directories**: Skips and continues with other spaces
- **File system errors**: Throws error with descriptive message

## Performance Considerations

- Basic listing is fast (O(n) where n = number of spaces)
- Statistics calculation is slower (requires recursive file counting)
- Use `include_stats: false` (default) for quick listings
- Tag filtering happens in-memory after loading all spaces

## Related Tools

- `create_space` - Create a new space
- `get_space_info` - Get detailed information about a specific space
- `delete_space` - Delete a space permanently
- `copy_space` - Copy space data to another space
