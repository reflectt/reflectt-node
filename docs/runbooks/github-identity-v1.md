# Runbook — GitHub identity v1 (PAT fallback + GitHub App installation tokens)

This documents how `reflectt-node` authenticates to GitHub for **server-side reads** (PR + CI resolution in `resolvePrAndCi`).

## Modes

### 1) PAT mode (default)
Uses environment variables:
- `GITHUB_TOKEN` (preferred)
- `GH_TOKEN`

No other configuration needed.

### 2) GitHub App installation token mode
Uses a GitHub App **installation access token** minted on-demand from an App private key.

**Enable:**
- `REFLECTT_GITHUB_IDENTITY_MODE=app_installation`

**SecretVault keys (defaults):**
- `github.app.private_key_pem` — PEM private key for the GitHub App
- `github.app.app_id` — GitHub App ID (numeric)
- `github.app.installation_id` — installation ID (numeric)

Override secret names with env vars if needed:
- `REFLECTT_GITHUB_APP_PRIVATE_KEY_SECRET`
- `REFLECTT_GITHUB_APP_ID_SECRET`
- `REFLECTT_GITHUB_APP_INSTALLATION_ID_SECRET`

### Storing secrets (SecretVault)
Secrets must be stored in the per-host SecretVault (encrypted at rest under `~/.reflectt/secrets/`).

Example (via node console/CLI tooling):
- create secret `github.app.private_key_pem`
- create secret `github.app.app_id`
- create secret `github.app.installation_id`

(If you don’t have a CLI helper yet, use whatever internal vault helper exists to call `vault.create(name, value)`.)

## Permissions
For PR/CI resolution, the App should have read permissions:
- Pull requests: Read
- Commit statuses / checks: Read

## Notes
- Installation tokens are short-lived. The provider caches them in-memory and refreshes with a 60s safety buffer.
- If App mode is enabled but misconfigured, the system falls back to PAT env vars (if present).
