# Development Workflow

> **Rule:** Mac Daddy (production host) runs the npm-installed version of reflectt-node. Agents never edit source files on the production host. All code changes go through PRs, and production updates come through npm releases.

## The Split

| Environment | Purpose | How it runs |
|---|---|---|
| **Production** (Mac Daddy) | Live service, real users | `npm install -g reflectt-node` → `reflectt start` via launchctl |
| **Development** (Docker or worktree) | Code changes, testing | `npm run dev` (tsx watch) or `docker build && docker run` |

## Development Flow

### 1. Make changes in a feature branch

```bash
cd ~/.openclaw/workspace/projects/reflectt-node
git checkout -b link/task-xxx
# Edit code...
npm run dev    # Test locally with tsx (auto-restart on changes)
npm test       # Run tests before committing
```

### 2. Test in Docker (recommended for production-like testing)

```bash
docker build -t reflectt-node-dev .
docker run --rm -p 4446:4445 reflectt-node-dev
# Test against http://localhost:4446
```

### 3. Create PR, get review, merge

```bash
git push origin link/task-xxx
gh pr create --title "feat: ..." --base main
# Wait for CI + reviewer approval
# Merge via GitHub
```

### 4. Deploy to production

```bash
# After PR is merged and npm publish is done:
npm update -g reflectt-node
reflectt restart
# Or via launchctl:
launchctl kickstart -k gui/$(id -u)/com.reflectt.node
```

## What NOT to Do

❌ **Don't run `npm run build` in the dev workspace and restart production** — the production binary points to `/opt/homebrew/lib/node_modules/reflectt-node/dist/`, not your workspace.

❌ **Don't edit source files on Mac Daddy to fix production issues** — hotfixes go through PRs like everything else. Use `reflectt start --tsx` if you need an emergency source-level fix while waiting for an npm release.

❌ **Don't `npm link` the dev workspace into global** — this creates invisible coupling between dev and production.

## Emergency Hotfix Path

If production is down and you can't wait for npm publish:

```bash
cd /opt/homebrew/lib/node_modules/reflectt-node
# Make minimal fix directly (document it!)
reflectt restart
# Immediately: create PR with the same fix, merge, publish
```

This is a last resort. Document every emergency hotfix in a task comment.

## Production Verification

```bash
# Check what's running
reflectt status
# Check version
curl -s http://127.0.0.1:4445/health | jq '.version'
# Check binary path
which reflectt  # Should be /opt/homebrew/bin/reflectt
readlink -f $(which reflectt)  # Should be .../node_modules/reflectt-node/dist/cli.js
```
