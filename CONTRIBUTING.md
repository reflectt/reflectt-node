# Contributing to reflectt-node

Thanks for your interest in contributing. This is an active project — we merge PRs fast when they're focused and well-tested.

## Before you start

If you're fixing a bug: check if there's an open issue first, then go. Small focused fixes get merged the fastest.

If you're adding a feature: open an issue to discuss it before writing code. We're opinionated about scope.

## Development setup

**Prerequisites:**
- Node.js ≥ 20
- npm ≥ 9

```bash
git clone https://github.com/reflectt/reflectt-node.git
cd reflectt-node
npm install
npm run build
```

**Run the server:**
```bash
npm run dev        # Development mode (hot reload via tsx)
npm start          # Production mode (compiled)
```

The server runs at `http://localhost:4445` by default. Open `http://localhost:4445/dashboard` to see the UI.

**First-run setup:**

The server auto-creates `~/.reflectt/` on first start. If you want to test with a clean state:
```bash
rm -rf ~/.reflectt && npm run dev
```

## Running tests

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

We have ~1500 tests. New code needs tests. PRs that drop coverage get asked to add them.

## Making changes

**Small fix:** Just open a PR. No need to ask.

**Medium change:** Check the [open issues](https://github.com/reflectt/reflectt-node/issues) or open one to align before you start.

**Large change:** Open a discussion issue first — "RFC: ..." in the title helps us know it's for feedback.

## PR checklist

- [ ] `npm test` passes
- [ ] `npm run build` succeeds (no TypeScript errors)
- [ ] Changes are focused — one thing per PR
- [ ] Commit message is clear ("feat: add X" / "fix: Y when Z")

We don't require a full test suite for documentation changes. We do for anything touching the API or data layer.

## Project structure

```
src/
├── server.ts       # Fastify server + all routes
├── cli.ts          # CLI commands (reflectt init, start, stop, etc.)
├── database.ts     # SQLite initialization and schema
├── health.ts       # Board health, SLA alerts, agent tracking
├── workers/        # Background workers (board health, task sweeper, etc.)
└── ...

dashboard/
└── ...             # Browser dashboard (served from the API)

docs/
└── ...             # User-facing documentation
```

## API conventions

- REST. JSON in, JSON out.
- `compact=true` on GET endpoints reduces response size 50-75% — useful for agents.
- All task mutations require `status`, `assignee`, or substantive fields — not just metadata patches.
- Errors return `{ "error": "...", "code": "...", "status": <http_code> }`.

## Questions?

Open an issue or join [Discord](https://discord.com/invite/clawd).

---

*Internal team process docs (task state machine, QA bundle requirements, reviewer handoff templates) are in `docs/internal/` — not relevant for external contributors.*
