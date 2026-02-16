# Semantic Search API

Local vector-based semantic search using sqlite-vec. All embeddings stay on-device.

## Endpoints

### `GET /search/semantic?q=<query>`

Search across indexed tasks and chat messages by meaning, not just keywords.

**Query Parameters:**
- `q` (required) — natural language search query
- `limit` (optional, default 10, max 50) — number of results
- `type` (optional) — filter by source type: `task` or `chat`

**Response:**
```json
{
  "query": "agent enrollment flow",
  "results": [
    {
      "sourceType": "task",
      "sourceId": "task-123",
      "textSnippet": "Agent-friendly host enrollment: CLI/API token generation...",
      "distance": 0.42,
      "similarity": 0.704
    }
  ],
  "count": 1
}
```

### `GET /search/semantic/status`

Check if vector search is available and how many items are indexed.

**Response:**
```json
{
  "available": true,
  "indexed": {
    "total": 250,
    "tasks": 200,
    "chat": 50
  }
}
```

### `POST /search/semantic/reindex`

Manually trigger re-indexing of all existing tasks. Useful after first enabling vector search on an existing instance.

**Response:**
```json
{
  "indexed": 195,
  "total": 200
}
```

## How It Works

1. **Embedding model:** `Xenova/all-MiniLM-L6-v2` via transformers.js (384-dim vectors)
2. **Storage:** sqlite-vec virtual table alongside the main SQLite database
3. **Auto-indexing:** New tasks and chat messages (≥10 chars) are automatically indexed on creation
4. **Privacy:** All embeddings are generated and stored locally — no external API calls

## Requirements

- `sqlite-vec` npm package (installed as a dependency)
- `@xenova/transformers` for embedding generation

## Configuration

- `REFLECTT_EMBED_MODEL` — override the embedding model (default: `Xenova/all-MiniLM-L6-v2`)
