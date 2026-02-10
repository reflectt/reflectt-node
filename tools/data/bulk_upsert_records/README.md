# bulk_upsert_records

Bulk insert or update multiple records in a single operation.

## Features

- **Batch Processing**: Handles large datasets by processing in configurable batches
- **Conflict Handling**: Detects conflicts based on specified columns and updates or skips accordingly
- **Schema Validation**: Validates records against table schema before insertion
- **Progress Tracking**: Returns detailed statistics (inserted, updated, skipped, errors)
- **Performance Optimized**: Only returns records when needed, processes in batches
- **Atomic Batches**: Each batch is processed atomically

## Usage

### Basic Bulk Insert

```typescript
{
  "table": "users",
  "records": [
    { "name": "Alice", "email": "alice@example.com", "age": 30 },
    { "name": "Bob", "email": "bob@example.com", "age": 25 },
    { "name": "Charlie", "email": "charlie@example.com", "age": 35 }
  ]
}
```

### Upsert with Conflict Handling

```typescript
{
  "table": "products",
  "records": [
    { "id": "prod-1", "name": "Widget", "price": 19.99, "stock": 100 },
    { "id": "prod-2", "name": "Gadget", "price": 29.99, "stock": 50 }
  ],
  "conflictColumns": ["id"],
  "updateOnConflict": true
}
```

### Large Dataset with Custom Batch Size

```typescript
{
  "table": "logs",
  "records": [...], // 500 records
  "batchSize": 50,
  "validate": false,  // Skip validation for performance
  "returnRecords": false
}
```

## Parameters

- `table` (required): Table name
- `records` (required): Array of records to upsert (1-1000 records)
- `conflictColumns`: Columns to check for conflicts (default: ['id'])
- `updateOnConflict`: Update on conflict vs skip (default: true)
- `returnRecords`: Return processed records (default: false)
- `validate`: Validate against schema (default: true)
- `batchSize`: Records per batch (default: 100, max: 1000)

## Output

```typescript
{
  "success": true,
  "inserted": 45,
  "updated": 5,
  "skipped": 0,
  "errors": [],
  "batchesProcessed": 1,
  "totalTime": 234
}
```

## Performance Considerations

- Use larger batch sizes (500-1000) for simple records
- Disable validation for trusted data sources
- Set `returnRecords: false` for large operations
- Maximum 1000 records per call (use multiple calls for larger datasets)

## Error Handling

Errors are collected per-record and returned in the `errors` array:

```typescript
{
  "errors": [
    {
      "index": 42,
      "record": { ... },
      "error": "Required field 'email' is missing"
    }
  ]
}
```

Processing continues even if individual records fail.
