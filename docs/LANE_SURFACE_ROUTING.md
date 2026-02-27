# Lane + Surface routing (task metadata)

We use two lightweight metadata fields to keep routing predictable and to keep **Pixel** focused on **design/UX work**.

These are *metadata-only* fields (no DB migration required).

## Fields

### `metadata.lane`
Recommended values:

- `design`
- `product`
- `infra`
- `ops`
- `growth`

### `metadata.surface`
Recommended values:

- `reflectt-node`
- `reflectt-cloud-app`
- `reflectt.ai`
- `infra`

## Pixel routing contract (hard default)

Pixel is **excluded by default** from assignee/reviewer auto-suggestions unless the task **explicitly opts in** via one of:

- `metadata.lane = "design"`
- `metadata.surface` is a user-facing surface (`reflectt-node`, `reflectt-cloud-app`, `reflectt.ai`, or `user-facing`)
- tags include any of: `design`, `ui`, `ux`, `a11y`, `css`, `visual`, `dashboard`, `copy`, `brand`, `marketing`

### Hard exclusion (onboarding plumbing)

If `metadata.cluster_key` indicates onboarding plumbing (e.g. `ws-pairing`, `auth`, `preflight`, `provisioning`, etc.), Pixel is excluded **unless** `metadata.lane="design"` is explicitly set.

## How to opt into design review

When you create a user-facing UI task, set at least one of:

```json
{
  "metadata": {
    "lane": "design",
    "surface": "reflectt-cloud-app",
    "tags": ["ui", "a11y"]
  }
}
```

This prevents accidental routing of infra/onboarding plumbing work to design.
