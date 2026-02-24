# Managed-Host Pilot Gating Policy v1

**Task:** task-1771873643808-4p6cdmw5i  
**Author:** kai  
**Reviewer:** sage  
**Parent RFC:** task-1771873793028-2mqxd9h3d (multi-tenancy + threat model)  
**Parent decision:** task-1771357806767-mrocopejk (DEFER managed-host to gated pilot)  
**Status:** draft

---

## 0) Summary

This policy defines the financial, operational, and admission gates for accepting tenants into the managed-host pilot. No tenant is onboarded unless **all three gates** pass.

**Gates:**
1. **Pricing gate** — tenant price must exceed max COGS threshold
2. **Reliability gate** — we meet defined SLOs before accepting tenants
3. **Admission gate** — tenant meets allowlist criteria; exit criteria are pre-agreed

---

## 1) Max COGS per Active Host

### 1.1 Cost model (per tenant/month)

| Component | Low estimate | High estimate | Notes |
|---|---:|---:|---|
| VM (1 vCPU / 2GB RAM) | $15 | $35 | Shared-CPU instances (Hetzner/DO/Fly low end; AWS/GCP high end) |
| Storage (20GB SSD + backups) | $5 | $15 | Local SSD + daily snapshot |
| Egress + networking | $2 | $10 | Depends on connector activity volume |
| Monitoring/logging | $3 | $10 | Basic metrics + log retention (30d) |
| Secret management overhead | $2 | $5 | Per-tenant encryption keys + rotation |
| **Infra subtotal** | **$27** | **$75** | |
| Support labor (amortized) | $15 | $40 | Assumes 1–2h/tenant/month at pilot scale (3–5 tenants) |
| Incident overhead (amortized) | $5 | $15 | Postmortem + remediation time |
| **Total COGS floor** | **$47** | **$130** | |

### 1.2 Max COGS threshold

**Rule: Max allowable COGS = 70% of tenant monthly price.**

This means:
- If COGS = $47–$130/tenant/month, minimum viable price = **$68–$186/month**
- **Pilot pricing floor: $99/month** (targets low-end COGS with ~30% gross margin)
- **No tenant accepted below $99/month** regardless of strategic value

### 1.3 COGS monitoring

- Track actual infra cost per tenant monthly (VM + storage + egress + logging)
- Track support hours per tenant monthly
- If any single tenant's actual COGS exceeds 85% of their price for 2 consecutive months → trigger exit review (see §3.4)
- Quarterly: re-evaluate cost model against actuals and adjust pricing floor if needed

### 1.4 LLM/API costs

LLM inference costs (OpenAI, Anthropic, etc.) are **excluded** from managed-host COGS — these are passed through or BYO-key in v1. If we absorb LLM costs in a future tier, add a separate line item and re-gate.

---

## 2) Reliability SLO + Incident/On-call Minima

### 2.1 Availability SLO

| Metric | Target | Measurement |
|---|---|---|
| Data plane uptime | **99.0%** (pilot) | Monthly, per-tenant; measured as: minutes with successful health check / total minutes |
| Planned maintenance window | Max 2h/month | Announced 24h in advance; excluded from uptime calc |
| Control plane uptime | **99.5%** | Monthly aggregate across all tenants |

**Why 99.0% for pilot (not 99.9%):** We have a 3–5 tenant pilot with no HA, running single-VM per tenant. Promising 99.9% without redundancy is dishonest. 99.0% = ~7.3h downtime/month — realistic for a team learning ops at this scale.

**Graduation to 99.5%+ requires:** multi-AZ or hot standby + automated failover + 3 months of data showing we consistently beat 99.5%.

### 2.2 Incident response times

| Severity | Definition | Response time | Resolution target |
|---|---|---|---|
| **P1 — Total outage** | Tenant data plane completely unreachable; no workaround | **30 min** (acknowledge) | 4h |
| **P2 — Degraded** | Partial functionality loss (e.g., connectors down, slow queries) | **2h** | 24h |
| **P3 — Minor** | Cosmetic, non-blocking, or workaround exists | **24h** | 5 business days |

### 2.3 On-call requirements (pre-launch)

Before accepting the first pilot tenant, the following must be in place:

1. **On-call rotation defined** — at minimum, one named agent + one named human escalation path (Ryan for pilot)
2. **Alerting pipeline** — health check fails → alert fires within 5 min → on-call notified (Telegram/Signal/push)
3. **Runbook for P1** — documented steps to: diagnose tenant VM, restart services, failover if possible, communicate to tenant
4. **Incident log** — every P1/P2 gets a postmortem within 48h, stored in `process/incidents/`
5. **Tenant communication channel** — defined per-tenant channel (email or chat) for status updates during incidents

### 2.4 SLO breach consequences

- **Single month breach (< 99.0%):** postmortem required; tenant notified with root cause + remediation
- **Two consecutive months breach:** mandatory review — either fix root cause within 30 days or offer tenant graceful exit with prorated refund
- **Three consecutive months:** automatic exit offer + pause new admissions until SLO is met for 2 consecutive months

---

## 3) Allowlist Admission + Exit Criteria

### 3.1 Admission requirements (ALL must be true)

| # | Criterion | Rationale |
|---|---|---|
| 1 | Tenant agrees to pilot terms (no SLA guarantee, best-effort, data retention policy) | Legal clarity; pilot is explicitly pre-GA |
| 2 | Use case fits GitHub-only connector scope | RFC §8.1: no email/chat connectors in v1 |
| 3 | Tenant provides their own LLM API keys (BYO) | We don't absorb inference costs in pilot |
| 4 | Monthly price ≥ $99 (pricing floor) | COGS gate (§1.2) |
| 5 | Tenant is a known contact (not anonymous signup) | Pilot trust requirement; we need direct communication channel |
| 6 | Total active tenants ≤ 5 | RFC §8.2: blast-radius cap |
| 7 | On-call + alerting + P1 runbook are operational (§2.3) | Don't accept tenants we can't support |
| 8 | Tenant acknowledges: single-tenant isolation, no BYO vault, no HA guarantee | Set expectations correctly |

### 3.2 Admission process

1. Tenant expresses interest → **kai or sage** evaluates against §3.1 checklist
2. If all criteria pass → provision tenant runtime (VM + secrets + connector setup)
3. Send tenant: onboarding doc + pilot terms + communication channel setup
4. Add to tenant registry in control plane
5. Verify health check passes end-to-end before declaring "live"

### 3.3 Ongoing review (monthly)

For each active tenant:
- [ ] COGS within 70% of price? (§1.2)
- [ ] SLO met this month? (§2.1)
- [ ] Any P1/P2 incidents? If yes, postmortem filed?
- [ ] Tenant still active (sent at least 1 request in past 30 days)?
- [ ] Total tenants still ≤ 5?

### 3.4 Exit criteria (tenant removal)

A tenant is exited from the pilot if **any** of:

| Trigger | Process |
|---|---|
| Tenant requests exit | 30-day wind-down; export workspace data; deprovision VM |
| COGS > 85% of price for 2 consecutive months | Offer price adjustment or graceful exit (30 days) |
| SLO breach for 3 consecutive months | Automatic exit offer + prorated refund |
| Tenant inactive (0 requests) for 60 days | Notify → 14-day grace period → deprovision |
| Security incident affecting tenant isolation | Immediate investigation; if isolation boundary was breached, pause all tenants + mandatory RFC review before resuming |
| No-go condition triggered (RFC §8.4) | Immediate pause; all tenants notified; no new admissions until resolved |

### 3.5 Expansion beyond 5 tenants

Per RFC §8.2, expanding beyond 5 requires:
1. Reviewer signoff (sage + kai)
2. Updated on-call plan (can't be 1 person for 10+ tenants)
3. Re-run threat review against current architecture
4. 3 months of pilot data showing SLO compliance + COGS within targets
5. Updated cost model with actual (not estimated) numbers

---

## 4) Pre-launch Checklist

Before admitting tenant #1, **all** must be true:

- [ ] Single-tenant VM provisioning is automated (or documented manual steps < 30 min)
- [ ] Per-tenant secret store operational + encryption verified
- [ ] Health check endpoint + alerting pipeline tested end-to-end
- [ ] On-call rotation defined + escalation path to Ryan confirmed
- [ ] P1 runbook written and reviewed
- [ ] Tenant communication template ready (onboarding doc + pilot terms)
- [ ] COGS tracking mechanism in place (even if spreadsheet for pilot)
- [ ] This policy reviewed and approved by sage

---

## 5) Open Questions

- **Billing mechanism:** Stripe manual invoices for pilot, or automated? (Lean toward manual for 3–5 tenants)
- **Data export format:** What does "export workspace data" look like on exit? (Tarball of workspace dir + SQLite dump?)
- **Tenant self-service:** Any self-service in pilot, or fully operator-managed? (Recommend: fully managed for v1)

---

## 6) Caveats

- All cost estimates are directional based on public cloud pricing at pilot scale. Actual costs will vary.
- SLO targets are pilot-grade (99.0%). Do not market as enterprise-grade availability.
- This policy is for the **gated pilot only**. GA managed-host requires a separate review cycle.
- LLM costs excluded from COGS — if we later bundle LLM, this policy must be re-gated.
