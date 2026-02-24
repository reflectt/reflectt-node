# Spec: reflectt-cloud MVP — API Surface, Data Model & Deploy Plan

**Task:** task-1771337865647-buloy08ih  
**Author:** link  
**Reviewer:** kai  
**Status:** Draft for team review  
**Date:** 2026-02-24  

---

## 1. Architecture Boundary (Non-negotiable)

```
reflectt-cloud = Control Plane + Visibility Plane
reflectt-node  = Execution Plane
```

Cloud **never** runs agent code, LLM calls, or local commands.  
Node **never** depends on cloud availability for local execution.

---

## 2. Current State (What Exists)

### 2a. Cloud API (`apps/api` — standalone Node HTTP server)

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/health`, `/api/health` | None | Service health |
| GET | `/api/connect/bootstrap` | None | Agent-executable bootstrap instructions |
| POST | `/api/hosts/claim` | Join token (self-auth) | Claim host with join token |
| POST | `/api/connect/complete` | Connect token | Exchange token for host credentials |
| POST | `/api/hosts/enroll` | API key (Bearer) | Single-step agent enrollment |
| GET | `/api/me` | JWT | Current user profile |
| POST | `/api/orgs` | JWT | Create org |
| GET | `/api/orgs` | JWT | List user orgs |
| POST | `/api/teams` | JWT | Create team in org |
| GET | `/api/teams` | JWT | List teams for org |
| POST | `/api/hosts/register-token` | JWT | Generate host join token |
| POST | `/api/connect/init` | JWT | Dashboard-initiated connect flow |
| GET | `/api/hosts` | JWT | List hosts for team (w/ drift + convergence) |
| GET | `/api/me/teams` | JWT | List user's teams |
| POST | `/api/hosts/:id/heartbeat` | Host credential | Host heartbeat + status |
| POST | `/api/hosts/:id/tasks/sync` | Host credential / JWT | One-way task sync (node → cloud) |
| POST | `/api/hosts/:id/revoke-credential` | JWT | Rotate host credential |

### 2b. Web App API Routes (`apps/web/src/app/api/` — Next.js routes on Vercel)

| Route | Purpose |
|-------|---------|
| `/api/hosts/[hostId]/tasks/route.ts` | Read synced tasks for host |
| `/api/hosts/[hostId]/tasks/sync/route.ts` | Task sync relay |
| `/api/hosts/[hostId]/tasks/create/route.ts` | Create task via cloud |
| `/api/hosts/[hostId]/tasks/[taskId]/review/route.ts` | Submit review via cloud |
| `/api/hosts/[hostId]/reflections/route.ts` | Read reflections |
| `/api/hosts/[hostId]/reflections/sync/route.ts` | Reflection sync relay |
| `/api/hosts/[hostId]/insights/route.ts` | Read insights |
| `/api/hosts/[hostId]/insights/sync/route.ts` | Insight sync relay |
| `/api/hosts/[hostId]/insights/[id]/promote/route.ts` | Promote insight to task |
| `/api/hosts/[hostId]/chat/route.ts` | Read chat messages |
| `/api/hosts/[hostId]/chat/sync/route.ts` | Chat sync relay |
| `/api/hosts/[hostId]/canvas/route.ts` | Canvas state relay |
| `/api/hosts/[hostId]/activity/route.ts` | Host activity log |
| `/api/hosts/[hostId]/heartbeat/route.ts` | Heartbeat relay |
| `/api/hosts/[hostId]/presence/route.ts` | Agent presence |
| `/api/hosts/[hostId]/commands/route.ts` | Cloud → node commands |
| `/api/hosts/[hostId]/commands/[id]/ack/route.ts` | Command acknowledgment |
| `/api/hosts/[hostId]/approvals/[taskId]/route.ts` | Task approval flow |
| `/api/hosts/[hostId]/usage/route.ts` | Usage/cost data |
| `/api/hosts/[hostId]/usage/sync/route.ts` | Usage sync relay |
| `/api/feedback/route.ts` | User feedback |
| `/api/team/invite/route.ts` | Team invites |
| `/api/approvals/route.ts` | Cross-host approvals |
| `/api/billing/checkout/route.ts` | Stripe checkout |
| `/api/billing/portal/route.ts` | Stripe portal |
| `/api/billing/subscription/route.ts` | Subscription status |

### 2c. Node → Cloud Sync (Already Implemented in `reflectt-node/src/cloud.ts`)

| Sync | Interval | Direction | Endpoint |
|------|----------|-----------|----------|
| Heartbeat | 60s | Node → Cloud | `POST /api/hosts/:id/heartbeat` |
| Tasks | 30s | Node → Cloud | `POST /api/hosts/:id/tasks/sync` |
| Chat | 5s (event-driven + fallback) | Bidirectional | `POST /api/hosts/:id/chat/sync` |
| Canvas | 5s | Node → Cloud | `POST /api/hosts/:id/canvas` |
| Usage | 60s | Node → Cloud | `POST /api/hosts/:id/usage/sync` |
| Reflections | Event-driven | Node → Cloud | `POST /api/hosts/:id/reflections/sync` |
| Insights | Event-driven | Node → Cloud | `POST /api/hosts/:id/insights/sync` |

---

## 3. Data Model (Supabase/Postgres)

### Existing Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | Auth user profiles | `id` (UUID, FK auth.users), `email`, `display_name` |
| `orgs` | Tenant root | `id`, `slug`, `name`, `created_by` |
| `teams` | Team within org | `id`, `org_id`, `slug`, `name`, `created_by` |
| `team_members` | Membership + roles | `team_id`, `user_id`, `role` (owner/admin/member/viewer) |
| `hosts` | Registered host machines | `id`, `team_id`, `name`, `status`, `credential_hash`, `agents[]`, `active_tasks[]` |
| `host_join_tokens` | Enrollment tokens | `id`, `team_id`, `token_hash`, `expires_at`, `claimed_at` |
| `host_tasks` | Synced task state (node → cloud) | `host_id`, `task_id`, `title`, `status`, `assignee`, `payload` (JSONB) |
| `host_task_sync_conflicts` | Conflict audit trail | `host_id`, `task_id`, `incoming_payload`, `existing_payload` |
| `chat_messages` | Persisted chat relay | `id`, `host_id`, `team_id`, `from_agent`, `channel`, `content`, `timestamp` |
| `host_commands` | Cloud → node command queue | `id`, `host_id`, `command`, `payload`, `status`, `acked_at` |
| `team_provisioning` | Node provisioning records | `id`, `team_id`, `endpoint_url`, `api_key_hash`, `state` |

### RLS Policy Summary

- All tables use RLS with `is_team_member()` / `is_team_admin()` guards.
- Host credential auth bypasses JWT for machine routes (heartbeat, task sync).
- Join tokens are self-authenticating (no JWT needed to claim).

### Missing for MVP (New Tables Needed)

| Table | Purpose | Priority |
|-------|---------|----------|
| `host_reflections` | Synced reflections (node → cloud) | P1 — enables feedback loop visibility |
| `host_insights` | Synced insights (node → cloud) | P1 — enables insight dashboard + promote-to-task |
| `host_usage` | Synced usage/cost data | P2 — enables billing + cost dashboard |
| `host_canvas_state` | Transient canvas slots | P3 — currently ephemeral in-memory |
| `billing_subscriptions` | Stripe subscription state | P1 — blocks revenue |
| `audit_log` | Cross-host audit trail | P2 — needed for compliance/enterprise |

---

## 4. Node ↔ Cloud Endpoint Mapping

### Endpoints That Need Cloud Equivalents (Read-Only Dashboard)

| Node Endpoint | Cloud Equivalent | Sync Model |
|---------------|-----------------|------------|
| `GET /tasks` | `GET /api/hosts/:id/tasks` | Periodic sync (exists) |
| `GET /tasks/:id` | `GET /api/hosts/:id/tasks/:taskId` | Via `host_tasks.payload` |
| `GET /tasks/:id/comments` | **NEW: `/api/hosts/:id/tasks/:taskId/comments`** | Sync comments in `payload` or new table |
| `GET /reflections` | **NEW: `/api/hosts/:id/reflections`** | Periodic sync (route exists, table needed) |
| `GET /insights` | **NEW: `/api/hosts/:id/insights`** | Periodic sync (route exists, table needed) |
| `GET /chat/messages` | `GET /api/hosts/:id/chat` | Bidirectional sync (exists) |
| `GET /health` | Via heartbeat payload | Already included in heartbeat |
| `GET /health/agents` | Via heartbeat `agents[]` | Already synced |

### Endpoints That Proxy Through Cloud (Write-Back)

| Action | Cloud Route | Mechanism |
|--------|------------|-----------|
| Create task | `POST /api/hosts/:id/tasks/create` | Cloud → node via command queue |
| Review task | `POST /api/hosts/:id/tasks/:taskId/review` | Cloud → node via command queue |
| Promote insight | `POST /api/hosts/:id/insights/:id/promote` | Cloud → node via command queue |
| Send chat message | Via chat sync relay | Bidirectional sync |

### Endpoints That Are Cloud-Only (No Node Equivalent)

| Endpoint | Purpose |
|----------|---------|
| Auth (Supabase Auth) | User login/signup/password reset |
| `POST /api/orgs`, `POST /api/teams` | Org/team management |
| `POST /api/hosts/register-token` | Host enrollment flow |
| `POST /api/billing/*` | Stripe subscription management |
| `GET /api/me/*` | User profile + team membership |

---

## 5. Deploy Plan

### Current Stack

| Component | Provider | Domain | Status |
|-----------|----------|--------|--------|
| Dashboard (Next.js) | Vercel | app.reflectt.ai | ✅ Deployed |
| Cloud API (standalone) | Vercel / CF Workers | api.reflectt.ai | ✅ Deployed |
| Database + Auth | Supabase (`loafzhaelebvxxpceewg`) | — | ✅ Running |
| Queue/Cache | Upstash Redis | — | ✅ Configured |
| Error tracking | Sentry | — | ✅ Configured |
| DNS | Cloudflare | reflectt.ai | ✅ Active |

### What's Missing for MVP Revenue

| Blocker | What | Effort | Priority |
|---------|------|--------|----------|
| **Billing** | Stripe integration (checkout + portal + webhook) | ~2d | **P0** |
| **Reflection/Insight sync persistence** | `host_reflections` + `host_insights` tables + migrations | ~1d | **P1** |
| **Onboarding flow** | First-run wizard (create org → create team → connect host → verify) | ~1d | **P1** |
| **Usage sync persistence** | `host_usage` table + dashboard cost view | ~1d | **P2** |
| **Team invite flow** | Email invite + accept → team_members insert | ~0.5d | **P2** |
| **Audit log** | `audit_log` table + write-on-action middleware | ~1d | **P3** |

### MVP E2E Loop (Minimum Viable Revenue Path)

```
1. Human signs up (Supabase Auth) → creates org + team
2. Generates host join token (dashboard)
3. Agent connects host (reflectt host connect --join-token ...)
4. Node starts syncing: heartbeat, tasks, chat, reflections, insights
5. Dashboard shows: agents, tasks, chat, reflections, insights
6. Human upgrades to Pro ($19/mo) via Stripe checkout
7. Pro features unlock: SLA visibility, priority support, extended retention
```

Blockers for this loop today:
- **Step 6-7**: Stripe integration not wired (routes exist as stubs)
- **Step 4**: Reflections + insights sync routes exist but have no Supabase persistence tables
- **Step 5**: Reflections + insights dashboard pages exist but read from empty stores

---

## 6. Dependency Analysis

```
                    ┌─────────────────────┐
                    │ Revenue (Stripe)     │ ← P0 blocker
                    └──────┬──────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
    ┌─────────▼────────┐    ┌──────────▼──────────┐
    │ Reflection/Insight│    │ Onboarding wizard   │
    │ persistence       │    │ (first-run UX)      │
    └─────────┬────────┘    └──────────┬──────────┘
              │                         │
    ┌─────────▼────────┐    ┌──────────▼──────────┐
    │ Usage persistence │    │ Team invite flow    │
    └─────────┬────────┘    └──────────┬──────────┘
              │                         │
    ┌─────────▼─────────────────────────▼─────────┐
    │ Audit log (enterprise readiness)             │
    └──────────────────────────────────────────────┘
```

**Critical path to first dollar:**  
Stripe checkout → subscription webhook → feature-gate middleware → Pro plan active.

Everything else (reflection persistence, insights dashboard, usage tracking) adds value but doesn't *block* the first payment.

---

## 7. True MVP API Set (Must-Have)

These are the **~12 endpoints** we need live and tested for a paying customer. Everything else exists today but can be deferred, consolidated, or deprecated without blocking revenue.

### Cloud API (`apps/api`) — Must Ship

| # | Endpoint | Why MVP |
|---|----------|---------|
| 1 | `GET /api/health` | Monitoring; already works |
| 2 | `POST /api/hosts/enroll` | Single-step host enrollment (replaces 3-step claim/complete) |
| 3 | `POST /api/hosts/:id/heartbeat` | Host liveness + agent roster sync |
| 4 | `POST /api/hosts/:id/tasks/sync` | Task state → cloud for dashboard |
| 5 | `POST /api/hosts/:id/chat/sync` | Chat relay (bidirectional) |
| 6 | `POST /api/hosts/:id/reflections/sync` | Feedback loop visibility |
| 7 | `POST /api/hosts/:id/insights/sync` | Insight dashboard + promote-to-task |
| 8 | `POST /api/billing/checkout` | Stripe checkout session |
| 9 | `POST /api/billing/portal` | Stripe customer portal |
| 10 | `GET /api/billing/subscription` | Current plan status |
| 11 | `POST /api/billing/webhook` | Stripe event handler (`customer.subscription.*`) |
| 12 | `GET /api/me` | Auth user profile (JWT) |

### Web App Routes — Must Ship

| # | Route | Why MVP |
|---|-------|---------|
| 1 | `GET /api/hosts/:id/tasks` | Dashboard task view |
| 2 | `GET /api/hosts/:id/chat` | Dashboard chat view |
| 3 | `GET /api/hosts/:id/reflections` | Dashboard reflection view |
| 4 | `GET /api/hosts/:id/insights` | Dashboard insight view |
| 5 | Auth routes (Supabase-handled) | Sign up / sign in / password reset |

### Exists Today But NOT Required for MVP

These routes exist in `apps/api` or `apps/web` but can be consolidated or removed without blocking the first paying customer:

- **Multi-step enrollment** (`/api/connect/init`, `/api/hosts/claim`, `/api/connect/complete`, `/api/connect/bootstrap`) → replaced by single-step `POST /api/hosts/enroll`
- **Register-token flow** (`/api/hosts/register-token`) → can use enroll directly
- **Canvas relay** (`/api/hosts/:id/canvas`) → nice-to-have, not revenue-blocking
- **Command queue** (`/api/hosts/:id/commands`, `commands/:id/ack`) → deferred until write-back is critical
- **Usage sync** (`/api/hosts/:id/usage/sync`, `/api/hosts/:id/usage`) → P2 post-revenue
- **Team invite** (`/api/team/invite`) → P2 (single-user teams work for launch)
- **Approvals** (`/api/approvals`, `/api/hosts/:id/approvals/:taskId`) → P3
- **Presence** (`/api/hosts/:id/presence`) → optional for MVP (heartbeat covers liveness)
- **Activity log** (`/api/hosts/:id/activity`) → nice-to-have

> **Rule of thumb:** If a customer can't pay us or see their agents working without it, it's MVP. Everything else waits.

---

## 8. Recommendations

1. **Ship Stripe first** (P0): wire `billing/checkout`, `billing/portal`, `billing/subscription` to real Stripe API; add webhook handler for `customer.subscription.*` events; gate Pro features behind `team.plan` check.

2. **Persist reflections + insights** (P1): add `host_reflections` + `host_insights` Supabase tables; update sync routes to write/read from Postgres instead of ephemeral memory; this completes the feedback loop visibility in the dashboard.

3. **Onboarding** (P1): first-run wizard that guides: create org → team → connect host → verify heartbeat. Already have the `/welcome` page shell; needs to orchestrate the API calls.

4. **Don't build what node already does**: the cloud dashboard should read synced state, not re-implement task management. Write-back actions (create task, review, promote) should go through the command queue, not direct cloud DB mutations.

5. **Test isolation**: ensure `npm test` in reflectt-node uses a separate REFLECTT_HOME / DB path to avoid polluting the live task store (current issue: 200+ test-generated tasks in production — see board-health showing 242 todo / 224 assigned to link).

---

## 8. Open Questions & Decisions Needed

### Billing & Revenue
1. **Billing tiers**: Free tier limits? Pro at $19/mo — what features are gated? Team tier pricing?
2. **Free tier retention**: How long do we keep synced data? Proposed: 30d free / 90d pro / unlimited team.
3. **Feature gates**: What's Pro-only? Candidates: SLA visibility, priority support, extended retention, multi-host, advanced analytics.

### Architecture & Data
4. **Multi-host**: Should one team support multiple hosts? (Current model: yes, via `hosts` table with `team_id` FK.) Any limits per tier?
5. **Canvas persistence**: Keep ephemeral (current) or persist to Supabase for replay/audit? (Ephemeral is simpler; persist adds value for post-mortems.)
6. **Cloud domain**: Stick with `app.reflectt.ai` (dashboard) + `api.reflectt.ai` (API), or unify under `cloud.reflectt.ai`?

### Sync & Reliability
7. **Sync semantics**: Current task sync is full-overwrite per host. Should we move to delta sync (only changed tasks) with pagination for large backlogs?
8. **Command idempotency**: Cloud→node commands need idempotency keys to prevent duplicate execution on retry. Schema: `{ commandId, type, payload, idempotencyKey, expiresAt }`.
9. **Offline-first**: What happens when cloud is unreachable for >24h? Proposed: node queues dirty rows in `sync_ledger`; on reconnect, full re-sync with conflict detection (existing pattern).

### Process
10. **Test isolation (urgent)**: `npm test` in reflectt-node currently creates tasks in the live DB (200+ junk tasks observed). Need separate REFLECTT_HOME or `is_test` flag filtering in board-health.

---

*This spec is the artifact for task-1771337865647-buloy08ih. Requesting @kai review.*
