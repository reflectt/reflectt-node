# Security Runbook — reflectt-node

## Secret Scanning

### CI (Automated)
- **Workflow:** `.github/workflows/secret-scan.yml`
- **Tool:** [gitleaks](https://github.com/gitleaks/gitleaks) via GitHub Action
- **Runs on:** Every PR and push to main
- **Required for merge:** Yes (recommended — enable branch protection rule)

### Pre-commit (Local)
- **Config:** `.pre-commit-config.yaml`
- **Setup:**
  ```bash
  # Install pre-commit
  brew install pre-commit   # macOS
  pip install pre-commit     # pip

  # Install hooks in this repo
  cd reflectt-node
  pre-commit install
  ```
- Scans staged files before each commit. Blocks commits containing secrets.

### Manual Scan
```bash
# Install gitleaks
brew install gitleaks

# Scan working directory
gitleaks detect --source . --verbose

# Scan git history
gitleaks detect --source . --verbose --log-opts="--all"

# Scan specific commit range
gitleaks detect --source . --log-opts="HEAD~10..HEAD"
```

## Allowlist / False Positives

- Config: `.gitleaks.toml`
- Test files are excluded by default (`tests/*.test.ts`)
- To add a false positive:
  1. Add to `.gitleaks.toml` allowlist with a comment explaining why
  2. Get PR approval from a reviewer
  3. Never allowlist real credentials — rotate them instead

## Credential Rotation Checklist

### When a secret is exposed:

1. **Identify** — What credential? Where exposed? What access does it grant?
2. **Contain** — Remove from codebase immediately (PR → merge)
3. **Rotate** — Generate new credential in provider dashboard
4. **Deploy** — Update all systems using the credential:
   - `~/.openclaw/.env` for local secrets
   - `launchctl setenv` + `openclaw gateway install --force` for service env
   - Cloud deployment env vars (Vercel, etc.)
5. **Verify** — Confirm new credential works, old credential is rejected
6. **Purge history** (if public repo or high-risk):
   ```bash
   # Using BFG Repo-Cleaner
   bfg --replace-text passwords.txt repo.git
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive
   ```
7. **Document** — Post incident report with timeline, cause, containment, prevention

### Key locations

| Secret | Storage | Rotation |
|--------|---------|----------|
| BRAVE_API_KEY | `~/.openclaw/.env` | [Brave Search Dashboard](https://brave.com/search/api/) |
| OPENCLAW_GATEWAY_TOKEN | `~/.openclaw/.env` + launchd | `openclaw gateway install --force && openclaw gateway restart` |
| GitHub tokens | GitHub Settings | GitHub → Settings → Developer settings |
| Supabase keys | Supabase dashboard | Project Settings → API |

## Incident History

### 2026-02-21: BRAVE_API_KEY + OPENCLAW_GATEWAY_TOKEN exposure
- **Cause:** `ps aux` output with full environment committed as artifact in `artifacts/idle-nudge/`
- **Commit:** `0a0fd1654e3f`
- **Containment:** PR #219 removed files + added .gitignore rules
- **Rotation:** Both keys rotated same day
- **Prevention:** This secret scanning setup (CI + pre-commit + gitleaks config)
