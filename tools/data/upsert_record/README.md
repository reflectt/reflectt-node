# Save Record (Upsert Record)

## Description

Save a structured record to a table in a space. Enforces database-like structure with tables/[table-name]/schema.json and tables/[table-name]/rows/[row-id].json. Auto-generates schema on first record. Mimics PostgreSQL table structure for structured data.

## Purpose and Use Cases

- **Structured data storage**: Store records in organized tables
- **Database-like organization**: Maintain schema and data separately
- **Auto-schema generation**: Automatically create schemas from first record
- **Multi-space support**: Save to current space or specific named spaces
- **Timestamp tracking**: Automatic created_at and updated_at timestamps
- **ID generation**: Auto-generate UUIDs if not provided

## Input Parameters

### Required Parameters

| Parameter | Type | Description | Pattern |
|-----------|------|-------------|---------|
| `table` | string | Table name (e.g., 'stories', 'characters', 'worlds', 'users') | `^[a-z0-9_-]+$` |
| `record` | object | Record data as JSON object. Will auto-add 'id', 'created_at', 'updated_at' if missing. | - |

### Optional Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target_space` | string | Save to a specific named space (e.g., 'creative', 'education'). Defaults to current space. |

## Output Format

```typescript
{
  success: boolean
  id?: string              // Generated or provided record ID (UUID)
  path?: string           // Relative path to saved record file
  schema_path?: string    // Path to schema file (if created)
  error?: string          // Error message if failed
}
```

**Success Example (First Record - Schema Created):**
```json
{
  "success": true,
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "path": "tables/stories/rows/a1b2c3d4-e5f6-7890-abcd-ef1234567890.json",
  "schema_path": "tables/stories/schema.json"
}
```

**Success Example (Subsequent Records):**
```json
{
  "success": true,
  "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "path": "tables/stories/rows/b2c3d4e5-f6a7-8901-bcde-f12345678901.json"
}
```

**Error Example:**
```json
{
  "success": false,
  "error": "EACCES: permission denied, mkdir '/readonly/tables/stories'"
}
```

## Example Usage

### Example 1: Save a Story Record

```typescript
import upsertRecord from './implementation'

const result = await upsertRecord(
  {
    table: 'stories',
    record: {
      title: 'The Time Traveler',
      author: 'AI Writer',
      genre: 'sci-fi',
      word_count: 1500,
      storage_path: 'storage/stories/time-traveler.md',
      tags: ['time-travel', 'science-fiction', 'adventure']
    }
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

console.log(result)
// {
//   success: true,
//   id: "uuid-generated",
//   path: "tables/stories/rows/uuid-generated.json",
//   schema_path: "tables/stories/schema.json"  // If first record
// }
```

### Example 2: Save Character Record with Specific ID

```typescript
const result = await upsertRecord(
  {
    table: 'characters',
    record: {
      id: 'char_sarah_chen',  // Custom ID provided
      name: 'Sarah Chen',
      age: 35,
      occupation: 'Physicist',
      traits: ['intelligent', 'curious', 'cautious'],
      backstory: 'A brilliant scientist who discovers time travel'
    }
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

console.log(result.id)  // "char_sarah_chen"
```

### Example 3: Save to Specific Space

```typescript
const result = await upsertRecord(
  {
    table: 'worlds',
    record: {
      name: 'Dystopian Future 2084',
      setting: 'Earth, year 2084',
      technology_level: 'Advanced',
      government_type: 'Totalitarian',
      population: 8500000000
    },
    target_space: 'creative'  // Save to 'creative' space
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)
```

### Example 4: Update Existing Record

```typescript
// First, save a record
const createResult = await upsertRecord(
  {
    table: 'users',
    record: {
      id: 'user_123',
      name: 'John Doe',
      email: 'john@example.com',
      status: 'active'
    }
  },
  dataDir,
  globalDir
)

// Later, update the same record by using same ID
const updateResult = await upsertRecord(
  {
    table: 'users',
    record: {
      id: 'user_123',  // Same ID = update
      name: 'John Doe',
      email: 'john.doe@example.com',  // Updated email
      status: 'active',
      last_login: '2025-10-17T14:30:00Z'  // New field
    }
  },
  dataDir,
  globalDir
)

// updated_at will be automatically set to current time
```

### Example 5: Save with Timestamps

```typescript
import getCurrentTime from '../time/get_current_time/implementation'

async function saveWithCustomTimestamp(table: string, data: any) {
  const time = await getCurrentTime({}, dataDir, globalDir)

  const result = await upsertRecord(
    {
      table,
      record: {
        ...data,
        // These will be used if provided, otherwise auto-generated
        created_at: time.timestamp,
        updated_at: time.timestamp
      }
    },
    dataDir,
    globalDir
  )

  return result
}

const result = await saveWithCustomTimestamp('events', {
  event_type: 'user_login',
  user_id: 'user_123',
  ip_address: '192.168.1.1'
})
```

### Example 6: Batch Insert Records

```typescript
async function saveMultipleRecords(table: string, records: any[]) {
  const results = []

  for (const record of records) {
    const result = await upsertRecord(
      { table, record },
      dataDir,
      globalDir
    )
    results.push(result)
  }

  return results
}

const records = [
  { name: 'Character 1', role: 'Protagonist' },
  { name: 'Character 2', role: 'Antagonist' },
  { name: 'Character 3', role: 'Mentor' }
]

const results = await saveMultipleRecords('characters', records)
console.log(`Saved ${results.filter(r => r.success).length} records`)
```

### Example 7: Complex Nested Data

```typescript
const result = await upsertRecord(
  {
    table: 'projects',
    record: {
      name: 'WorkRocket',
      description: 'AI-powered SaaS platform',
      tech_stack: {
        frontend: ['Next.js', 'TypeScript', 'TailwindCSS'],
        backend: ['Supabase', 'PostgreSQL'],
        ai: ['Claude', 'Anthropic SDK']
      },
      team_members: [
        { name: 'Alice', role: 'Developer' },
        { name: 'Bob', role: 'Designer' }
      ],
      metadata: {
        created_by: 'admin',
        version: '1.0.0',
        tags: ['saas', 'ai', 'productivity']
      }
    }
  },
  dataDir,
  globalDir
)
```

## Error Handling

The function catches all errors and returns them in the output:

```typescript
// Invalid table name
{
  success: false,
  error: "Invalid table name format"
}

// Permission denied
{
  success: false,
  error: "EACCES: permission denied, mkdir '/readonly/tables/stories'"
}

// Invalid directory
{
  success: false,
  error: "ENOENT: no such file or directory"
}
```

**Error Handling Pattern:**

```typescript
const result = await upsertRecord({ table: 'stories', record: data }, dataDir, globalDir)

if (!result.success) {
  console.error('Failed to save record:', result.error)
  // Handle error...
} else {
  console.log('Record saved:', result.id)
  console.log('Path:', result.path)
  if (result.schema_path) {
    console.log('Schema created:', result.schema_path)
  }
}
```

## File Structure

The function creates this structure:

```
{baseDir}/
└── tables/
    └── {table-name}/
        ├── schema.json           # Auto-generated from first record
        └── rows/
            ├── {uuid-1}.json     # Record 1
            ├── {uuid-2}.json     # Record 2
            └── {uuid-3}.json     # Record 3
```

**Example:**

```
data/
└── tables/
    ├── stories/
    │   ├── schema.json
    │   └── rows/
    │       ├── a1b2c3d4-e5f6-7890-abcd-ef1234567890.json
    │       └── b2c3d4e5-f6a7-8901-bcde-f12345678901.json
    └── characters/
        ├── schema.json
        └── rows/
            ├── char_sarah_chen.json
            └── char_john_smith.json
```

## Auto-Generated Schema

On first record insertion, a schema is automatically generated:

```json
{
  "table": "stories",
  "version": 1,
  "created_at": "2025-10-17T14:30:45.123Z",
  "fields": {
    "id": {
      "type": "string",
      "required": true,
      "description": "id field"
    },
    "title": {
      "type": "string",
      "required": false,
      "description": "title field"
    },
    "author": {
      "type": "string",
      "required": false,
      "description": "author field"
    },
    "genre": {
      "type": "string",
      "required": false,
      "description": "genre field"
    },
    "word_count": {
      "type": "number",
      "required": false,
      "description": "word_count field"
    },
    "tags": {
      "type": "array",
      "required": false,
      "description": "tags field"
    },
    "created_at": {
      "type": "string",
      "required": true,
      "description": "created_at field"
    },
    "updated_at": {
      "type": "string",
      "required": true,
      "description": "updated_at field"
    }
  },
  "indexes": ["id"],
  "description": "Auto-generated schema for stories table"
}
```

## Automatic Fields

The function automatically adds/updates these fields:

| Field | Type | Behavior |
|-------|------|----------|
| `id` | string (UUID) | Generated if not provided |
| `created_at` | string (ISO 8601) | Set on creation if not provided |
| `updated_at` | string (ISO 8601) | Updated on every save |

**Example:**

```typescript
// Input record
{
  title: 'My Story'
}

// Saved record (auto-fields added)
{
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  title: "My Story",
  created_at: "2025-10-17T14:30:45.123Z",
  updated_at: "2025-10-17T14:30:45.123Z"
}
```

## Space Targeting

**Default Behavior (no target_space):**
- Saves to `{dataDir}/tables/{table}/rows/{id}.json`

**With target_space:**
- Saves to `{globalDir}/../spaces/{target_space}/tables/{table}/rows/{id}.json`

## Performance Notes

- **Write speed:** ~1-5ms per record (SSD)
- **No transactions:** Each save is independent
- **No validation:** Schema is for reference only
- **No indexes:** ID is indexed in schema, but not enforced

## Related Tools

- **get_record**: Retrieve a specific record by ID
- **list_records**: List all records in a table
- **query_table**: Query records with filters
- **delete_record**: Delete a record
- **get_table_schema**: Get the table schema
- **upsert_table_schema**: Update table schema manually
