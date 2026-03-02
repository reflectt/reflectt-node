# Installer Source-of-Truth Decision

**Task:** task-1771521150513-zkggsk9jw  
**Author:** link  
**Status:** Decision  
**Date:** 2026-02-21  

## Current State

Three copies of install scripts exist:

| Location | Lines | Purpose | Installs |
|---|---|---|---|
| `reflectt-node/scripts/install.sh` | 193 | Staging/dev installer | OpenClaw npm package via `npm i -g openclaw` |
| `reflectt.ai/public/install.sh` | 116 | Production installer (served at reflectt.ai/install.sh) | Clones reflectt-node repo, builds, starts service |
| `reflectt.ai/scripts/install.sh` | 116 | Identical copy of public/ | Same as above |

**Problem:** Two different scripts doing different things. reflectt-node's version installs OpenClaw (the runtime). reflectt.ai's version installs reflectt-node (the product). Neither installs both. The user experience is broken — `curl reflectt.ai/install.sh | bash` doesn't get you a working system.

## Decision

**Source of truth: `reflectt-node/scripts/install.sh`**

### Rationale

1. **The installer is product code, not marketing code.** Install logic depends on OS detection, dependency checks, service management, and error handling. These are engineering concerns that belong in the product repo, not the marketing site.

2. **reflectt-node has CI and tests.** Changes to the installer can be reviewed, tested, and rolled back through the normal PR process. The marketing site has no test infrastructure for shell scripts.

3. **Single publish pipeline.** On merge to main, CI copies `scripts/install.sh` → an artifact URL. The marketing site fetches it. One source, one flow.

4. **The reflectt-node installer is more mature.** It has telemetry, partial install recovery, rollback markers, and proper error handling. The reflectt.ai version lacks these.

### What the unified installer should do

1. Check prerequisites (Node.js, git, npm)
2. Install OpenClaw if missing (`npm i -g openclaw`)
3. Clone/update reflectt-node
4. Build and start reflectt-node
5. Run health check
6. Print next steps (connect to cloud, add agents)

Currently each script does half. The unified version does all of it.

## Publish Pipeline

```
reflectt-node/scripts/install.sh  (source of truth)
       │
       ▼  [CI: on merge to main]
    GitHub Release artifact + raw.githubusercontent.com
       │
       ▼  [reflectt.ai build step]
    reflectt.ai/public/install.sh  (copy, served via Next.js static)
       │
       ▼  [Vercel deploy]
    https://reflectt.ai/install.sh  (user-facing URL)
```

**Fallback:** If Vercel is down, `curl https://raw.githubusercontent.com/reflectt/reflectt-node/main/scripts/install.sh | bash` works directly.

## Owner Matrix

| Responsibility | Owner | Backup |
|---|---|---|
| **Code owner** (install.sh logic) | link | kai |
| **Deploy owner** (CI → reflectt.ai) | sage | link |
| **Rollback owner** (revert bad installer) | link (git revert + force-push) | sage |
| **URL owner** (reflectt.ai/install.sh serves) | pixel (Vercel) | ryan |

## Migration Steps

1. **Merge the two scripts** — Add reflectt-node clone/build/start steps to `reflectt-node/scripts/install.sh`. Keep telemetry, error handling, partial markers.
2. **Delete `reflectt.ai/scripts/install.sh`** — Remove the duplicate.
3. **Update `reflectt.ai/public/install.sh`** — Replace with a one-liner that fetches from reflectt-node:
   ```bash
   #!/usr/bin/env bash
   # Thin wrapper — source of truth is reflectt-node/scripts/install.sh
   exec bash <(curl -fsSL https://raw.githubusercontent.com/reflectt/reflectt-node/main/scripts/install.sh) "$@"
   ```
4. **Add CI step** — On reflectt-node merge to main, publish `scripts/install.sh` as a GitHub Release asset.
5. **Test the full flow** — `curl reflectt.ai/install.sh | bash` on a clean machine.

### Risk Controls

- **Version pinning:** Installer includes `INSTALL_VERSION` that maps to a specific reflectt-node tag. Users don't get bleeding edge by default.
- **Rollback:** `git revert` on reflectt-node + Vercel redeploy. ~2min to fix.
- **Canary:** Add `REFLECTT_INSTALL_CHANNEL=canary|stable` env var. Canary gets HEAD, stable gets latest tag.

## Follow-up Tasks

1. **Unify installer** — Merge both scripts into `reflectt-node/scripts/install.sh` (P1, ~2h)
2. **CI publish step** — Add GitHub Actions workflow to publish installer on release (P2, ~30min)
3. **Thin wrapper for reflectt.ai** — Replace public/install.sh with redirect (P2, ~15min)
4. **E2E install test** — Docker-based test that runs `curl | bash` on clean Ubuntu (P2, ~1h)
