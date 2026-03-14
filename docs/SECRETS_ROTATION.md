# Secrets Rotation — reflectt-node (Mac Daddy)

## Where secrets live

Production secrets are stored in the **LaunchAgent plist** at:
```
~/Library/LaunchAgents/com.reflectt.node.plist
```

**Never** commit secret values to git. Use `.env` for local development only; `.env` is in `.gitignore`.

---

## Adding or rotating ANTHROPIC_API_KEY

### Step 1 — Edit the plist

Open with a text editor (or use `plutil`):

```bash
nano ~/Library/LaunchAgents/com.reflectt.node.plist
```

Inside the `<key>EnvironmentVariables</key><dict>` block, add:

```xml
<key>ANTHROPIC_API_KEY</key>
<string>sk-ant-XXXX…</string>
```

Full example block (truncated):
```xml
<key>EnvironmentVariables</key>
<dict>
    <key>ANTHROPIC_API_KEY</key>
    <string>sk-ant-XXXX…</string>
    <key>NODE_ENV</key>
    <string>production</string>
    …
</dict>
```

### Step 2 — Restart the service

```bash
launchctl kickstart -k gui/$(id -u)/com.reflectt.node
```

### Step 3 — Verify

```bash
curl -s http://127.0.0.1:4445/preflight | python3 -c "import sys,json; d=json.load(sys.stdin); print(d)"
```

Look for `anthropic_api_key: ok` (or equivalent check name in the preflight output).

### Step 4 — Rotate when compromised

1. Generate a new key at https://console.anthropic.com/keys
2. Revoke the old key immediately
3. Follow Steps 1–3 above with the new value
4. Confirm preflight passes before marking rotation complete

---

## Other secrets in the plist

| Key | Purpose | Where to get/rotate |
|-----|---------|---------------------|
| `OPENCLAW_GATEWAY_TOKEN` | OpenClaw gateway auth | OpenClaw dashboard |
| `REFLECTT_CLOUD_TOKEN` | Host credential for app.reflectt.ai | `POST /api/hosts/:id/rotate-credential` |

---

## Zero-secrets-in-git policy

- `.env` files are gitignored. Never add secret-containing files to git.
- Run `gitleaks detect --source .` before any push that touches config files.
- If a key is accidentally committed: revoke immediately, rotate, then clean history with `git filter-repo`.

---

## Rotation schedule

| Secret | Recommended rotation |
|--------|---------------------|
| `ANTHROPIC_API_KEY` | Every 90 days, or immediately on suspicion |
| `REFLECTT_CLOUD_TOKEN` | On any team member change, or via `/rotate-credential` endpoint |
| `OPENCLAW_GATEWAY_TOKEN` | On any security event |
