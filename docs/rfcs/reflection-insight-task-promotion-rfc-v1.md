# RFC (v1) — Reflection → Insight → Task promotion engine

- **Task:** task-1771691556414-qnlemhecd
- **Owner:** sage
- **Reviewer:** kai
- **Date:** 2026-02-24

## Goal (pilot: one lane)
Convert raw reflections into **deduped, scored insights** that can be **promoted** into tasks with guardrails (anti-spam + auditability).

**Pilot lane:** `reflectt-node` (internal ops / execution hygiene).

**Non-goals (v1):** perfect taxonomy, cross-lane analytics, “fully automatic” task creation for everything.

---

## 1) Reflection schema (v1 contract)
A *Reflection* is an atomic event.

**Required:** `id`, `ts`, `lane`, `pain`, `impact`, `evidence[]`, `author`, `confidence (0–1)`.

**Recommended:**
- `severity: low|medium|high|critical`
- `tags[]`: `stage:*`, `family:*`, `unit:*`
- `proposed_fix`, `metadata`

`EvidenceRef = { type: task|pr|artifact|log|screenshot|link, ref: string }`

---

## 2) Insight model + clustering (dedupe)
An *Insight* is a deduped cluster of reflections.

**Cluster key (v1):** `<stage>::<family>::<unit>`
- from `tags` (`stage:*`, `family:*`, `unit:*`), else `unknown`; `unit` falls back to `lane`.

**Deduping rules:**
- Attach a reflection to a cluster at most once (by `reflection.id`).
- Store `authors` and `evidence_refs` as **sets**.

---

## 3) Scoring + priority mapping (v1)
**Inputs:** `severity_max`, `n_reflections (7d)`, `n_authors`, `evidence_count`, `confidence_max`.

**Score (0–10):**
- base severity: low=2, medium=4, high=6, critical=8 (unknown=3)
- +1 if `n_authors>=2`
- +1 if `n_reflections>=3`
- +1 if `evidence_count>=2`
- +1 if `confidence_max>=0.8`

**Priority:** score≥8 → P0; ≥6 → P1; ≥4 → P2; else P3.

---

## 4) Promotion thresholds + gate (v1)
**Promotion-eligible** if either:
1) `n_authors>=2` **and** `score>=6`, OR
2) **High-severity override:** `severity_max in {high, critical}` **and** `evidence_count>=1`.

**Promotion gate (before creating a new task):**
- no open task already linked to this `insight_id` or same `cluster_key`
- task is actionable/testable
- includes success metric + rollback trigger

Eligible but gate fails → `pending_triage` (no task).

---

## 5) Cooldown + reopen rules (anti-spam)
- **Idempotency:** one task per insight (`insight.task_id`).
- **Creation cooldown:** after task creation, suppress new tasks for same `cluster_key` for **7 days** *or until the task is closed*, whichever is later.
- **Escalation bypass:** only if severity increases and new evidence appears.

---

## 6) Promotion → Task bridge (routing)
On `insight:promoted`:
- high/critical + gate pass → auto-create task
- else → `pending_triage`

Task must carry: `insight_id`, `cluster_key`, top evidence refs, score breakdown, success metric + rollback trigger.

---

## 7) Pilot plan (one lane, 7 days)
**Success:**
- ≥70% reflections attach to existing insight
- ≤1 reviewer-rejected promoted insight/day
- ≥80% auto-created tasks accepted by reviewer
- median high/critical+evidence → task < 5 minutes

**Rollback trigger (any 24h):** auto-created tasks >10 **or** rejects >50%.

**Rollback:** disable auto-create; route promotions to `pending_triage` until thresholds/taxonomy are fixed.
