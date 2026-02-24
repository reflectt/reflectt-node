# RFC / Decision (v1) — GitHub multi-identity model for agent teams

- **Task:** task-1771695803509-y5u7unfoc
- **Owner:** sage
- **Reviewer:** kai
- **Date:** 2026-02-24
- **Status:** Draft (decision-ready)

## Problem
Today we have a **single GitHub identity bottleneck**:
- one `gh` login / token context tends to get reused across agents/lanes
- the control-plane (gateway/service) may not inherit the same auth env that a dev shell has
- the result is: flaky CI/PR resolution, unclear audit trails, and no clean way to support multiple customer teams with distinct GitHub identities.

We need a **v1 model** that supports multiple “agent teams” (i.e., multiple Reflectt teams/workspaces) without requiring all automation to run under one human GitHub account.

## Goals (v1)
1. **One GitHub identity per team/workspace** (not per agent).
2. **Least privilege** by default (scoped access; easy revocation).
3. **Works for both:**
   - server-side GitHub reads (PR/CI resolution: reflectt-node)
   - agent-side GitHub writes (open PRs, push branches, comment)
4. **Operationally simple:** can be bootstrapped in <30 minutes for internal use.

## Non-goals (v1)
- Per-agent distinct GitHub actors (nice-to-have; adds complexity; not required for unblocking).
- Solving customer Git workflows end-to-end (forks, enterprise, SSO edge cases) — we just need a safe default model.

---

## Viable models (2–3)
### Model A — Shared bot user + PAT (single identity)
**What:** Create a dedicated GitHub user (e.g., `reflectt-bot`) and use a PAT (fine-grained if possible) everywhere.

**Pros**
- Fastest to ship.
- Works with `git` over HTTPS and `gh` immediately.

**Cons**
- Still a single identity across all teams (doesn’t actually solve multi-identity).
- Long-lived token risk.
- Harder to segment access per customer/team.

---

### Model B — Per-team machine user accounts + PAT/SSH (multi-identity via users)
**What:** Create one GitHub user per team/customer, store a token (or SSH key) per team.

**Pros**
- True multi-identity (GitHub UI shows different users per team).
- Simple mental model.

**Cons**
- High operational overhead (account creation, 2FA, recovery, billing, compliance).
- Secret storage + rotation burden scales linearly with customers.
- Still tends toward long-lived creds.

---

### Model C — GitHub App installation per team (recommended direction)
**What:** Use a GitHub App (owned by Reflectt) installed into each team’s GitHub org/repo(s). Mint **short-lived installation tokens** per team.

**Pros**
- Best-practice automation auth (short-lived, revocable per installation).
- Least privilege (per-installation permissions).
- Scales cleanly to customers.
- Works for reflectt-node server reads (PR/CI checks) with read-only permissions.

**Cons / caveats**
- Requires App setup and key handling.
- Git operations require HTTPS with token (still workable, but needs tooling/wrappers).
- GitHub UI will show “GitHub App” as actor (not a human user).

---

## Decision matrix (summary)
Criteria: **Security**, **Auditability**, **Customer scalability**, **Ops overhead**, **Works with git+gh**.

- **Model A (Shared PAT):** Security ✗ (long-lived), Auditability ~, Scalability ✗, Ops ✓, git+gh ✓
- **Model B (Per-team users):** Security ~, Auditability ✓, Scalability ✗, Ops ✗, git+gh ✓
- **Model C (GitHub App):** Security ✓, Auditability ✓ (as app), Scalability ✓, Ops ~, git+gh ~ (needs wrapper)

---

## Recommended v1 model
**Adopt Model C (GitHub App) as the default identity primitive**, with a pragmatic v1 operational layer:

1) **Per-team identity = one GitHub App installation**
- Each Reflectt team/workspace stores: `{ github_app_installation_id, repo allowlist }`.

2) **Two-token posture**
- **Server/read token (reflectt-node):** read-only permissions for PR + checks resolution.
- **Agent/write token (used by PR-creating workflows):** contents write + pull requests write.

3) **Local multi-identity isolation (when using `gh`)**
- Prefer **ephemeral token injection** (`GH_TOKEN` / `GITHUB_TOKEN`) per operation.
- If interactive `gh` login is needed, isolate profiles via `GH_CONFIG_DIR` per team.
  - `gh` explicitly supports `GH_CONFIG_DIR`.

This gets us multi-identity *per team* without requiring OS users per team.

---

## Migration path (from today’s single-account setup)
### Phase 0 — Stop the bleeding (same-day)
- Ensure service processes (gateway/reflectt-node) have a GitHub token available in runtime env for PR/CI reads.
  - `reflectt-node` uses `process.env.GITHUB_TOKEN || process.env.GH_TOKEN`.

### Phase 1 — Introduce GitHub App (v1)
1. Create GitHub App under Reflectt org.
2. Define minimal permissions:
   - read: pull requests, checks/statuses
   - write (optional for v1 writes): contents, pull requests
3. Install App on `reflectt/*` repos (internal dogfood) first.
4. Store App private key securely (host secret store).
5. Add token minting utility (library/CLI) that returns an installation token for a given team.
6. Update reflectt-node GitHub API calls to use installation token (server-read).

### Phase 2 — Team-scoped GitHub auth profiles
- Add a tiny contract:
  - `team.github.identity.type = app_installation | pat`
  - `team.github.identity.ref = installation_id | secret_ref`
- For agent workflows:
  - use `GH_TOKEN=<installation_token> gh ...`
  - optionally: `GH_CONFIG_DIR=~/.reflectt/gh/<teamId> gh auth login --with-token` (only if needed)

---

## Risks + mitigations
1. **Private key leakage**
   - Mitigate with OS keychain/secret vault, file perms, and rotation runbook.

2. **Git operations friction (token + git credentialing)**
   - Mitigate with wrappers that set `GIT_ASKPASS` or use `https://x-access-token:<token>@github.com/...`.
   - Keep PAT fallback only for internal dev until wrappers are solid.

3. **Auditability shows “App”, not humans**
   - Mitigate by enforcing PR templates / labels that include `requested_by`, and reflectt-node audit ledger entries linking task→PR.

4. **Enterprise/SSO edge cases**
   - Mitigate by making identity provider pluggable (`app_installation` vs `pat`) and scoping v1 to github.com.

---

## Next implementation tasks (out of scope for this decision)
- Implement `GitHubIdentityProvider` (App vs PAT) and wire into PR/CI resolvers.
- Add team-scoped secret storage + rotation runbook.
- Add wrappers for git push/clone under installation tokens.
