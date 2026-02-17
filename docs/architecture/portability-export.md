# Architecture: One-Click Config + Secrets Export

> Escape hatch for portability — export everything, import to self-hosted. No lock-in.

## Overview

Users can export their entire reflectt-node configuration in one action and
import it on a new host. This is a trust guarantee: you can leave without
rebuild pain.

## What's Exported

| Component | Included | Notes |
|-----------|----------|-------|
| TEAM.md | ✅ | Team charter |
| TEAM-ROLES.yaml | ✅ | Agent role definitions |
| TEAM-STANDARDS.md | ✅ | Team standards |
| config.json | ✅ (redacted) | Cloud credentials replaced with `[REDACTED]` |
| Encrypted secrets | ✅ (ciphertext) | Requires source HMK to decrypt |
| Webhook routes | ✅ | Provider, path, events, active status |
| Webhook delivery config | ✅ | Retry settings, TTL, concurrency |
| Provisioning state | ✅ (redacted) | Phase, host name, cloud URL — no credential |
| Custom files | ✅ | Any .md/.yaml/.json/.toml/.txt in ~/.reflectt/ |

## What's NOT Exported

- **Cloud credentials** — redacted, must re-enroll on new host
- **Host Master Key** — must be manually copied for secret import
- **SQLite database** — tasks, chat, presence are runtime state
- **Server PID file** — runtime only
- **Logs and cache** — transient data

## Export Bundle Format (v1.0.0)

```json
{
  "version": "1.0.0",
  "format": "reflectt-export",
  "exportedAt": "2026-02-16T...",
  "exportedFrom": {
    "hostId": "uuid-...",
    "hostName": "mac-daddy",
    "reflecttHome": "/Users/ryan/.reflectt"
  },
  "teamConfig": {
    "teamMd": "# Team Reflectt...",
    "teamRolesYaml": "agents:\n  - name: link...",
    "teamStandardsMd": "# Standards..."
  },
  "serverConfig": { "...redacted..." },
  "secrets": {
    "vaultExport": { "version": "1.0.0", "secrets": [...] },
    "secretCount": 3,
    "note": "Requires source HMK to decrypt"
  },
  "webhooks": {
    "routes": [...],
    "deliveryConfig": { "maxAttempts": 5, "..." }
  },
  "provisioning": {
    "phase": "ready",
    "hostName": "mac-daddy",
    "cloudUrl": "https://api.reflectt.ai"
  },
  "customFiles": [
    { "path": "defaults/TEAM.md", "content": "..." }
  ]
}
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/portability/export` | Full export bundle (JSON response) |
| GET | `/portability/export/download` | Download as .json file attachment |
| POST | `/portability/import` | Import bundle to ~/.reflectt/ |
| GET | `/portability/manifest` | Preview (counts/files, no content) |

## Import Behavior

- **Default**: skip existing files (no overwrite)
- **`overwrite: true`**: replace existing files
- **`skipSecrets: true`**: skip secret vault import
- **`skipConfig: true`**: skip config.json import
- Cloud credentials are never imported — user must re-enroll
- Warnings returned for skipped files and secret import instructions

## Secret Migration

Secrets are exported as encrypted ciphertext. To import on a new host:

1. Copy `~/.reflectt/secrets/host.key` from source to target
2. Import the bundle: `POST /portability/import { bundle: <export> }`
3. Or: generate new HMK on target and use `POST /secrets/import` with source HMK

## Security

- Credentials redacted in export (shown as `[REDACTED]`)
- Secrets remain encrypted (AES-256-GCM, requires HMK)
- No plaintext secrets in the bundle
- Export is a snapshot — no live sync
