# search_tools

Search for available tools by capability, keywords, or category. Uses fuzzy search across tool names, descriptions, parameters, and examples.

## Features

- **Fuzzy Search**: Finds tools even with partial matches
- **Relevance Scoring**: Ranks results by how well they match the query
- **Multi-Field Search**: Searches names, descriptions, parameters, tags, and examples
- **Category Filtering**: Filter results by tool category
- **Capability Filtering**: Find tools with specific capabilities (tags)
- **Configurable Results**: Control result count, minimum score, and example inclusion

## Usage

### Basic Search

```typescript
{
  "query": "bulk insert records"
}
```

Returns tools related to bulk record insertion, sorted by relevance.

### Category-Specific Search

```typescript
{
  "query": "send message",
  "category": "communication",
  "limit": 5
}
```

### Capability Search

```typescript
{
  "query": "process data",
  "capabilities": ["async", "bulk"],
  "includeExamples": true
}
```

### Advanced Search

```typescript
{
  "query": "analyze user behavior",
  "minScore": 30,
  "limit": 10,
  "includeExamples": true
}
```

## Scoring Algorithm

The search engine uses a weighted scoring system:

1. **Exact name match**: 100 points
2. **Name contains query**: 50 points
3. **Description contains query**: 30 points
4. **Category match**: 20 points
5. **Tag match**: 15 points per tag
6. **Parameter match**: 10 points per parameter
7. **Example match**: 5 points per example

**Bonuses**:
- Multiple word matches: 1.2x multiplier
- Query at start of field: 1.1x multiplier

## Output Example

```typescript
{
  "success": true,
  "results": [
    {
      "toolName": "bulk_upsert_records",
      "category": "data",
      "description": "Insert or update multiple records in one operation...",
      "relevanceScore": 85,
      "inputSchema": { ... },
      "usageExample": { ... },
      "tags": ["bulk", "batch", "upsert"],
      "matchedFields": ["name", "description", "tags (2)"]
    }
  ],
  "totalFound": 12,
  "searchTime": 45
}
```

## Tips

- Use natural language: "how to send bulk emails"
- Use keywords: "batch delete database"
- Combine with category: narrow down to specific tool types
- Adjust `minScore` to filter out weak matches
- Set `includeExamples: false` for faster results
