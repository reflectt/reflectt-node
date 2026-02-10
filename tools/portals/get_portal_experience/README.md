# get_portal_experience

Return the merged portal metadata (including the `metadata.experience` manifest) for a given portal. The tool honors space-level overrides and falls back to global defaults when needed so agents can reason about what the UI should render.

## Input

| Field | Type | Description |
| --- | --- | --- |
| `portal_id` | string | Portal id/slug. Defaults to `concierge`. |
| `space_id` | string | Optional space slug. Defaults to the caller's current space. |
| `include_metadata` | boolean | Include the full merged portal record instead of just the experience manifest. |

## Output

```
{
  "success": true,
  "portal_id": "concierge",
  "space": "default",
  "source": "global",
  "fallback_applied": false,
  "experience": { ... },
  "metadata": { ... } // only when include_metadata is true
}
```

`experience` is the object stored under `metadata.experience` in the merged portal record. If no experience manifest exists, an empty object is returned along with `success: false` and an error message.
