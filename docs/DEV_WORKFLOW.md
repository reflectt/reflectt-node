# Dev Workflow — Production vs. Development

## The Rule

**Production hosts run reflectt-node from npm install. Always.**

```bash
# Production (Mac Daddy, any customer host)
npm install -g reflectt-node   # or: npm update -g reflectt-node
reflectt start                 # runs from /opt/homebrew/lib/node_modules/...
```

Agents and automation must **never** edit source files or run `npx tsx src/index.ts` on a production host. The dev source tree (`~/.openclaw/workspace/projects/reflectt-node`) exists for development only — it is not the running server.

## Why This Matters

On 2026-03-11, an agent edited TypeScript source directly on Mac Daddy (the production host). The launchctl service was running the compiled `dist/` from the global npm install, not from source. The edit had no effect on the running server — but when the service restarted, stale `dist/` from the dev tree caused a crash.

**Source edits on production = invisible until they cause a crash.**

## Development Workflow

### 1. Code changes → Feature branch

```bash
cd ~/.openclaw/workspace/projects/reflectt-node
git checkout -b link/task-xyz main
# Make changes, write tests
npm test
```

### 2. Test locally → Dev mode only

```bash
npm run dev          # tsx watch — runs from source, no build step
# Test your changes against localhost:4445
# ⚠️ This is for dev testing only. Never leave dev mode running as production.
```

### 3. Ship → PR → Merge → Release

```bash
gh pr create --fill
# Wait for CI (tests + docs contract + review)
# After merge: cut a release or update the global install
```

### 4. Deploy to production

```bash
# On the production host:
npm update -g reflectt-node
launchctl kickstart -k gui/$(id -u)/com.reflectt.node
curl -s http://localhost:4445/health | jq .version
```

## What Agents Must Not Do on Production

| ❌ Don't | ✅ Do Instead |
|----------|---------------|
| Edit files under `projects/reflectt-node/src/` | Create a PR from a feature branch |
| Run `npx tsx src/index.ts` as the server | Use `reflectt start` (npm global) |
| Run `npm run dev` as the production server | Use launchctl / `reflectt start` |
| Modify `dist/` directly | Run `npm run build` after merge, or let the install handle it |
| Run tests that start a competing server on :4445 | Use `npm test` (vitest uses random ports) |

## Docker Dev Environment (Future)

For fully isolated testing without risk to production:

```bash
docker run -it --rm -v $(pwd):/app -w /app node:22 bash
npm install
npm test
npm run dev  # Safe — isolated container
```

This is the target state for agent development. Until Docker workflow is automated, agents use feature branches + PR workflow on the dev source tree, and never touch production directly.
