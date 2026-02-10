# Create Space

## Description

Create a new space with a given name. Spaces are isolated environments for organizing data, agents, tasks, and storage.

## Purpose and Use Cases

- **Primary use**: Create isolated workspace environments for different projects, teams, or purposes
- **Integration**: Works with space management tools
- **Requirements**: Needs dataDir, globalDir
- **Structure**: Creates directory structure with subdirectories for agents, tasks, tables, and storage

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `space_name` | string | Name of the space to create (lowercase, alphanumeric, underscores, hyphens only) |

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `description` | string | - | Optional description of what this space is for |
| `metadata` | object | - | Optional metadata to store with the space (tags, owner, purpose, etc.) |

## Output Format

```typescript
{
  success: boolean;
  space_name: string;
  path: string;
  message: string;
  created_at: string;
}
```

## Example Usage

```typescript
import createSpace from './implementation'

// Basic usage
const result = await createSpace(
  {
    space_name: 'my-project'
  },
  dataDir,
  globalDir
)

// With description and metadata
const result = await createSpace(
  {
    space_name: 'customer-support',
    description: 'Customer support ticket management',
    metadata: {
      owner: 'support-team',
      tags: ['support', 'tickets'],
      purpose: 'production'
    }
  },
  dataDir,
  globalDir
)

console.log(result)
// {
//   success: true,
//   space_name: 'customer-support',
//   path: '/path/to/data/spaces/customer-support',
//   message: "Space 'customer-support' created successfully",
//   created_at: '2025-10-17T12:00:00.000Z'
// }
```

## Directory Structure Created

```
data/spaces/[space_name]/
├── agents/          # Agent definitions and configurations
├── tasks/           # Task management data
├── tables/          # Data tables and schemas
├── storage/         # File storage
└── space.json       # Space metadata
```

## Error Handling

The function throws errors in these cases:

- **Invalid space name**: Name must match pattern `^[a-z0-9_-]+$`
- **Space already exists**: Cannot create space with duplicate name
- **File system errors**: Automatically cleans up partial creation on failure

## Validation Rules

- Space name must be lowercase
- Only alphanumeric characters, underscores, and hyphens allowed
- No spaces or special characters
- Must not be empty

## Related Tools

- `list_spaces` - List all available spaces
- `get_space_info` - Get detailed information about a space
- `delete_space` - Delete a space permanently
- `copy_space` - Copy space data to another space
