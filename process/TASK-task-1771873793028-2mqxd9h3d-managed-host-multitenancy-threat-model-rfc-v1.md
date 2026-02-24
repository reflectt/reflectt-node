# RFC (v1): Managed-host multi-tenancy model + threat assessment

**Task:** task-1771873793028-2mqxd9h3d  
**Owner:** sage  
**Reviewer:** kai  
**Status:** draft

## 0) Summary (decision)
We can offer a managed-host path **only** if we treat each customer as an isolated security boundary.

**Recommendation (v1 pilot):** *single-tenant data plane* (one tenant per VM or hard-isolated container+OS-user) with a thin shared control plane.
- No “true” multi-tenant runtime in a shared workspace/process.
- Multi-tenancy is implemented as **fleet management** (many isolated tenant runtimes), not co-residency.

**Why:** lowers blast radius, makes the threat model tractable, avoids “we host your creds” until we have isolation+secrets+auditability.

---

## 1) Context + scope
This RFC defines:
1) **Multi-tenancy architecture** for a managed-host offering.
2) **Threat model** (assets, adversaries, trust boundaries, top risks).
3) **Security boundary definitions**.
4) **Isolation requirements** + **pilot guardrails** (explicit no-go conditions).

Out of scope (v1): full SOC2 program, multi-region HA, billing, enterprise SSO.

---

## 2) Terminology
- **Tenant**: a customer org/workspace in our system.
- **Control plane**: our shared services (UI/API, billing, fleet registry).
- **Data plane**: tenant runtime that executes agent code and stores tenant artifacts.
- **Workspace**: tenant’s filesystem + state (tasks/reflections/insights/db).
- **Connector secret**: credentials for GitHub/email/chat/etc.

---

## 3) Architecture model (v1)
### 3.1 Control plane (shared)
Responsibilities:
- Tenant registry + provisioning
- Routing/auth to tenant runtimes
- Minimal metadata (tenant id, region, runtime id)

Constraints:
- Control plane **must not** have direct access to tenant workspace files or secrets.
- Control plane stores only what’s needed for routing + audit.

### 3.2 Data plane (per-tenant runtime)
**Strong isolation goal:** compromise of one tenant runtime must not grant access to any other tenant’s:
- filesystem/artifacts
- DB/state
- secrets
- network connectors

**Recommended deployment unit (pilot):**
- 1 tenant = 1 VM (strongest) **or** 1 tenant = 1 container set + dedicated OS user + locked-down filesystem (acceptable only if hardened).

Inside the tenant runtime:
- OpenClaw gateway + agent processes
- Local state (SQLite) and artifacts
- Optional connectors (GitHub, etc.) subject to pilot allowlist

### 3.3 Identity + auth
- Every request from control plane to data plane includes:
  - `tenant_id`
  - signed short-lived token (mTLS preferred in v2)
- Data plane validates token and enforces tenant-scoped access.

### 3.4 Data storage
- Tenant state stored inside the tenant runtime (local SQLite for pilot).
- No shared DB tables for tenant work data in v1.

### 3.5 Networking
- Default-deny inbound to data plane; only control plane can reach a narrow API surface.
- Egress allowlist by connector type (GitHub API, etc.).

---

## 4) Security boundaries (explicit)
We define **hard boundaries**:
1) **Tenant boundary**: tenant-to-tenant isolation must hold even if a tenant is malicious.
2) **Control-plane boundary**: control plane operators/services should not be able to casually read tenant workspaces.
3) **Connector boundary**: connector secrets are the highest-risk asset; storage and use must be minimized.

---

## 5) Threat model
### 5.1 Assets
- Tenant workspace files (artifacts, logs, transcripts)
- Tenant state DB (tasks/reflections/insights)
- Connector secrets (GitHub tokens, email creds, chat tokens)
- Execution environment (ability to run code / tools)
- Audit logs (who did what)

### 5.2 Adversaries
- Malicious tenant user
- Compromised tenant device/session
- External attacker exploiting a vuln in control plane or data plane
- Insider risk (operator with elevated access)

### 5.3 Trust boundaries + attack surfaces
- Browser/UI → control plane API
- Control plane → data plane API
- Agent execution → host OS/container runtime
- Tooling integrations (GitHub/web/email) → secrets + outbound network

---

## 6) Risk matrix (v1)
Scale: Likelihood (L/M/H), Impact (L/M/H).

| Risk | Likelihood | Impact | Notes | Mitigation/Requirement |
|---|---:|---:|---|---|
| Tenant-to-tenant data leak via shared filesystem | M | H | catastrophic for trust | **Single-tenant runtime**; per-tenant FS root; OS-level isolation |
| Tenant escape from agent sandbox to host | M | H | agents run tools; risk of RCE | Run in VM or hardened containers; drop privileges; seccomp/AppArmor; no host mounts |
| Secret exfiltration (connector tokens) | M | H | highest-value target | Secrets per-tenant; short-lived tokens where possible; encrypt-at-rest; strict allowlist |
| Control plane operator reads tenant workspace | M | H | insider risk | Separate control-plane and tenant runtime; require break-glass + audit; minimize shared storage |
| SSRF / request smuggling from data plane → internal | M | M/H | depends on network layout | Egress allowlist; metadata service blocked; VPC egress controls |
| Denial of service by noisy tenant | H | M | resource starvation | Per-tenant quotas (CPU/mem), rate limits, job caps |
| Supply-chain risk from tools/plugins | M | H | arbitrary tooling | Plugin allowlist for pilot; signed plugins later |
| Prompt injection to leak data across tenants | L/M | H | if shared memory exists | No shared memory; separate runtimes; redact logs by tenant |

---

## 7) Isolation requirements (must-have for pilot)
### 7.1 Runtime isolation
- One tenant per VM **preferred**.
- If container-based:
  - dedicated OS user per tenant
  - no privileged containers
  - no host socket mounts (Docker socket prohibited)
  - read-only root FS where feasible

### 7.2 Filesystem isolation
- Tenant workspace root path must be unique and not shared.
- Enforce path canonicalization; prevent `..` traversal.

### 7.3 Secrets handling
- Per-tenant secret store (even if simple): encrypted at rest with per-tenant key.
- Secrets never logged.
- Rotate/revoke mechanism documented.

### 7.4 Network isolation
- Data plane inbound only from control plane.
- Egress allowlist for pilot connectors.

### 7.5 Audit + observability
- Every control-plane → data-plane request logged with tenant_id + actor.
- Break-glass access requires explicit ticket + time-bounded token + audit trail.

---

## 8) Pilot guardrails + no-go conditions

### 8.1 Pilot scope restrictions (recommended)
- Connector allowlist: **GitHub only** (no email/chat) unless tenant brings their own connector infra.
- **No BYO vault in pilot (v1):** treat customer-managed secrets as v2. Pilot uses our per-tenant secret store + strict allowlist.
- No background “always-on” agents without explicit user enable.

### 8.2 Pilot size cap (blast-radius bound)
- **Pilot limited to 3–5 tenants**.
- Any expansion beyond 5 requires: reviewer signoff + updated on-call plan + re-run threat review.

### 8.3 Cost floor / COGS sanity check (directional)
Single-tenant data plane has a hard cost floor per tenant.
- **Estimate (rough):** $30–$80 / tenant / month infra floor (1 small VM + storage + basic logging), excluding support labor.
- **Use:** validate pricing gates (Task D) and ensure we don’t accept pilots below cost floor.

### 8.4 No-go conditions (do not launch managed-host)
- Any shared-tenant workspace filesystem.
- Any mechanism where one tenant can query another tenant’s tasks/reflections/insights.
- Any connector secret stored unencrypted or shared across tenants.
- No break-glass audit trail.

---

## 9) Migration path (to real multi-tenancy)
If/when we need co-residency:
1) Move from per-tenant VM → per-tenant microVM (e.g., Firecracker) for density.
2) Centralize logs/metrics with strict tenant tagging.
3) Replace long-lived PATs with GitHub App installation tokens.
4) Add formal threat model review + pen test before expanding connector scope.

---

## 10) Open questions
- Where do we want the fleet to live (AWS/GCP/self-host) and what’s the minimal ops surface?
- What is the smallest allowed tool set that still delivers value?

**Closed for v1 pilot:**
- BYO vault: **No** (v2+). Pilot uses our per-tenant secret store + connector allowlist.
