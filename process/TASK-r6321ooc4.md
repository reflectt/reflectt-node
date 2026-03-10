# Stagehand Browser Capability

**Task:** task-1773116119784-r6321ooc4
**PR:** #864
**Date:** 2026-03-09
**Author:** Link

## What

Local browser capability for reflectt-node using Stagehand v3. Agents can create isolated browser sessions and control them via HTTP endpoints.

## Architecture

- `src/capabilities/browser.ts` — Session manager singleton
  - Session lifecycle: create → act/extract/observe/navigate → close
  - Rate limiting: max 3 concurrent, 10/hour/agent
  - Auto-cleanup: idle sessions closed after 5 minutes
  - Lazy Stagehand import — only loaded when a session is created
  
- Routes in `src/server.ts` (11 endpoints under `/browser/`)
- Cleanup on shutdown in `src/index.ts`

## Constraints Met

- ✅ TypeScript-native, ESM
- ✅ Playwright-compatible (Stagehand uses Playwright under the hood)
- ✅ Local provider only (env: "LOCAL")
- ✅ No Browserbase / cloud browser dependency
- ✅ Stagehand as optional dependency (lazy import, graceful error)
- ✅ Lives under src/capabilities/
- ✅ Headless by default
- ✅ Session auto-close + cleanup

## Not in Scope (future work)

- MCP tool registration for browser actions
- CLI surface (beyond HTTP API)
- Persistent browser profiles across sessions
- Cloud browser provider support
