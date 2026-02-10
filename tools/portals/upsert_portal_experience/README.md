# upsert_portal_experience

Persist an updated `metadata.experience` manifest for a portal. The tool merges the current-space portal record with global defaults so agents can safely override only the pieces they care about.

## Request

```json
{
  "portal_id": "customer",      // optional, defaults to concierge
  "space_id": "workrocket",     // optional, defaults to caller space
  "experience": { ... },          // required manifest payload
  "merge": true,                  // optional shallow merge toggle (default false)
  "ensure_directories": true      // optional (default true)
}
```

- `experience` must be a JSON object. When `merge` is false (default), the existing manifest is replaced; otherwise the payload is shallow-merged.
- When the portal record does not yet exist in the space, this tool creates it (copying global defaults when available).

## Response

```json
{
  "success": true,
  "portal_id": "customer",
  "space": "workrocket",
  "operation": "updated",
  "experience": { ... },
  "metadata": { ... },
  "ensured_directories": ["/absolute/path/to/..."],
  "warning": "..." // when a global fallback was replaced
}
```

If validation fails or an IO error occurs, the response contains `success: false` with an `error` message.
