# Architecture: Host Provisioning

> Connect a host to Reflectt Cloud — enrollment, config pull, secret sync, webhook auto-configuration.

## Overview

Host provisioning is the process of connecting a fresh reflectt-node instance to
Reflectt Cloud. It builds on the [secret vault](./secret-vault.md) for encrypted
credential storage and the [cloud module](../CLOUD_ENDPOINTS.md) for ongoing sync.

## Provisioning Flow

```
┌──────────────┐
│ unprovisioned │
└──────┬───────┘
       │  POST /provisioning/provision { cloudUrl, joinToken/apiKey, hostName }
       ▼
┌──────────────┐
│  enrolling   │─── POST /api/hosts/claim (join token)
│              │    or POST /api/hosts/enroll (API key)
│              │    → receives hostId + credential
└──────┬───────┘
       │  credentials saved to ~/.reflectt/config.json
       ▼
┌────────────────┐
│ pulling_config │─── GET /api/hosts/:hostId/config
│                │    → team settings, defaults
└──────┬─────────┘
       ▼
┌─────────────────┐
│ pulling_secrets │─── GET /api/hosts/:hostId/secrets
│                 │    → encrypted secrets (wrapped DEKs)
└──────┬──────────┘
       ▼
┌───────────────────────┐
│ configuring_webhooks  │─── GET /api/hosts/:hostId/webhooks
│                       │    → provider configs, signing secrets
└──────┬────────────────┘
       ▼
┌───────┐
│ ready │  Host is fully provisioned
└───────┘
```

## Error Recovery

If any phase fails, the state is set to `error` with `lastError` recorded.
Re-running provision skips already-completed phases (enrollment is idempotent
once hostId + credential exist).

## Enrollment Methods

### 1. Join Token (Dashboard-generated)
```bash
# Admin generates token in cloud dashboard
# Token: hjoin_<random>

curl -X POST http://localhost:4445/provisioning/provision \
  -H 'Content-Type: application/json' \
  -d '{ "cloudUrl": "https://api.reflectt.ai", "joinToken": "hjoin_...", "hostName": "mac-daddy" }'
```

### 2. API Key (Agent/automation)
```bash
# Team API key: rk_live_<random>

curl -X POST http://localhost:4445/provisioning/provision \
  -H 'Content-Type: application/json' \
  -d '{ "cloudUrl": "https://api.reflectt.ai", "apiKey": "rk_live_...", "hostName": "ci-runner-1" }'
```

## Credential Storage

After enrollment:
1. `hostId` + `credential` saved to `~/.reflectt/config.json` (cloud section)
2. `provisioning.json` tracks full state machine
3. Cloud integration (`src/cloud.ts`) picks up credentials on next reload

```json
// ~/.reflectt/config.json
{
  "cloud": {
    "hostId": "uuid-...",
    "credential": "hcred_...",
    "cloudUrl": "https://api.reflectt.ai",
    "hostName": "mac-daddy"
  }
}
```

## Webhook Auto-Configuration

During provisioning, the host queries cloud for configured webhook routes:

```json
{
  "webhooks": [
    {
      "id": "wh_abc123",
      "provider": "github",
      "events": ["push", "pull_request"],
      "signingSecretName": "github_webhook_secret",
      "active": true
    }
  ]
}
```

Webhook signing secrets are stored in the local vault (never in plaintext config).
Routes are auto-registered at `/webhooks/<provider>`.

## Dashboard Visibility

`GET /provisioning/status` returns the full state for dashboard rendering:

```json
{
  "phase": "ready",
  "hostId": "uuid-...",
  "hostName": "mac-daddy",
  "cloudUrl": "https://api.reflectt.ai",
  "enrolledAt": 1771286000000,
  "provisionedAt": 1771286001000,
  "hasCredential": true,
  "webhooks": [...],
  "configPulledAt": 1771286000500,
  "secretsPulledAt": 1771286000800,
  "lastError": null
}
```

Note: `credential` is never exposed via the status endpoint — only `hasCredential: boolean`.

## Refresh Flow

After initial provisioning, `POST /provisioning/refresh` re-pulls:
- Config (team settings, defaults)
- Secrets (new/rotated encrypted secrets)
- Webhooks (added/removed routes)

Useful after team config changes in the cloud dashboard.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/provisioning/status` | Current provisioning state (no credentials) |
| POST | `/provisioning/provision` | Full enrollment + config pull flow |
| POST | `/provisioning/refresh` | Re-pull config/secrets/webhooks |
| POST | `/provisioning/reset` | Reset state for re-enrollment |
| GET | `/provisioning/webhooks` | List webhook routes |
| POST | `/provisioning/webhooks` | Add webhook route |
| DELETE | `/provisioning/webhooks/:id` | Remove webhook route |

## Dependencies

- `src/secrets.ts` — SecretVault for encrypted credential storage
- `src/cloud.ts` — Ongoing heartbeat + task sync (uses persisted credentials)
- `src/config.ts` — REFLECTT_HOME for state file location
- `~/.reflectt/config.json` — Persisted cloud credentials
- `~/.reflectt/provisioning.json` — Provisioning state machine

## Security Constraints

1. **Credential shown once**: Cloud returns `credential` with `revealPolicy: 'shown_once'`
2. **Status endpoint safe**: `GET /provisioning/status` never exposes the credential
3. **Config.json permissions**: Should be 0600 (owner-only) — contains credential
4. **Join tokens expire**: Default 15 minutes, one-time use
5. **API keys scoped to team**: Each team has its own API key for enrollment
