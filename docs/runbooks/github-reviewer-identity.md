# Runbook — Non-author GitHub identity for agent-side Approve/Merge (gh)

## Problem
If the machine/agent is authenticated to GitHub as the same account that authored a PR (e.g. `itskai-dev`), GitHub blocks an **Approve** review from that identity.

We need a **separate reviewer identity** available to automation so agents can:
- submit an Approve review
- merge a PR

…without opening the GitHub UI.

## Recommended approach (simple + explicit)
Use a dedicated reviewer account PAT via environment variables, without touching the default `gh` login.

### 1) Create a reviewer PAT
Create a GitHub account (or bot user) that is *not* the author identity (e.g. `reflectt-reviewer`).

Create a **fine-grained PAT** (preferred) or classic PAT with scopes that allow:
- reading repo + PR metadata
- submitting PR reviews
- merging PRs

Minimum permissions vary by org settings; start with repo-level permissions:
- Pull requests: Read & write
- Contents: Read
- Workflows: Read

### 2) Store the token
Store the PAT as a secret in your host secret store.

Suggested secret name(s):
- `GITHUB_REVIEWER_TOKEN` (env)
- `github.reviewer.pat` (SecretVault)

### 3) Run `gh` with explicit identity context
#### Option A: `GH_TOKEN` (recommended)
This is the cleanest because it’s per-command and doesn’t alter `gh`’s global auth state.

Approve as reviewer:
```bash
GH_TOKEN="$GITHUB_REVIEWER_TOKEN" gh pr review <pr-url-or-number> --approve
```

Merge as reviewer:
```bash
GH_TOKEN="$GITHUB_REVIEWER_TOKEN" gh pr merge <pr-url-or-number> --merge --delete-branch
```

#### Option B: separate `gh` config dir (`GH_CONFIG_DIR`)
Use this if you want `gh auth status` etc. to reflect the reviewer identity.

```bash
export GH_CONFIG_DIR="$HOME/.config/gh-reviewer"
# One-time login (token is read from stdin)
printf "%s" "$GITHUB_REVIEWER_TOKEN" | gh auth login --hostname github.com --with-token

gh auth status
# Now approve/merge using this config directory
GH_CONFIG_DIR="$HOME/.config/gh-reviewer" gh pr review <pr> --approve
```

## Regression check (manual)
Goal: approving a PR authored by `itskai-dev` succeeds when executed under the reviewer identity.

Example (from incident):
```bash
# Must be authored by itskai-dev
PR="https://github.com/reflectt/reflectt-node/pull/287"

# Should succeed (and not warn about author self-approval)
GH_TOKEN="$GITHUB_REVIEWER_TOKEN" gh pr review "$PR" --approve
```

## Rotation / revocation
- Rotate by generating a new PAT for the reviewer account, updating the secret, and revoking the old token.
- If compromise suspected: revoke immediately and audit recent merges/reviews.

## Notes
- Prefer keeping the machine’s default `gh` login as the “author/owner” identity and using `GH_TOKEN` only for reviewer actions.
- If we later need stronger guarantees ("required checks only" / App-based approvals), consider moving reviewer actions to GitHub Apps + server-side API calls.
