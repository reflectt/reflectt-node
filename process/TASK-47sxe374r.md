# TASK-47sxe374r — GitHub approvals: per-agent identity routing

Task: `task-1772171440251-47sxe374r`

## Problem
GitHub blocks self-approval: if the local environment is authenticated as the PR author, `gh pr review --approve` (and branch-protection merge) fails.
This frequently stalls merges because our host has a single shared GitHub identity.

## Decision: approval model
**Recommended:** per-agent fine-grained PATs stored in the Secret Vault.
- Each reviewer agent gets their own token.
- Approvals can be executed *as the assigned reviewer*.

**Fallback (optional):** shared reviewer/bot token `github.pat.reviewer`.
- Useful if a reviewer doesn’t have a GitHub account/token.
- Still avoids “self-approve” if the bot is not the author.

(We can later upgrade to GitHub App installation tokens for org-wide governance, but PATs are simplest to ship now.)

## What shipped
### Per-actor token resolution
New helper resolves tokens by actor without leaking secrets:
- SecretVault: `github.pat.<actor>` (preferred)
- SecretVault: `github.pat.reviewer` (fallback)
- Env fallback: `GH_TOKEN_<ACTOR>` / `GITHUB_TOKEN_<ACTOR>`
- Legacy: `GH_TOKEN` / `GITHUB_TOKEN`

### API endpoints
- `GET /github/whoami/:actor`
  - Returns `{login,id}` for the actor’s token (never returns token)
- `POST /github/pr/approve`
  - Body: `{ pr_url, actor, reason? }`
  - Submits an APPROVE review via GitHub API using the actor’s token.

### Docs + tests
- Added docs section: **GitHub approvals (per-agent identity routing)**
- Added unit tests for env token resolution + PR URL parsing.

## Proof plan (requires one more token)
To prove “agent A PR can be approved by agent B” on the same host:
1) Store a second identity in the vault:
   - `POST /secrets { name: "github.pat.harmony", value: "<PAT>", scope: "agent" }`
2) Validate identity:
   - `GET /github/whoami/harmony` → login = harmony’s GitHub user
3) Approve a PR authored by `itskai-dev`:
   - `POST /github/pr/approve { pr_url: "...", actor: "harmony" }`

## Files changed
- `src/github-actor-auth.ts`
- `src/github-reviews.ts`
- `src/server.ts`
- `public/docs.md`
- `tests/github-actor-auth.test.ts`
- `tests/github-reviews.test.ts`

## Tests
- `npm test` ✅ (1436 passed, 1 skipped)
- `npm run build` ✅
