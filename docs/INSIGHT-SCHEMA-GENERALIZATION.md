# Insight Schema Generalization — Role-Agnostic Design

**Task:** task-1771691567934-qrx91ngqk  
**Author:** link  
**Status:** Proposal  

## Problem

The current Reflection→Insight→Task pipeline assumes software engineering context:
- Cluster keys use `workflow_stage` / `failure_family` / `impacted_unit`
- `_inferFailureFamily()` matches only software patterns (crash, deploy, CI, auth)
- Tag prefixes (`stage:`, `family:`, `unit:`) map to engineering workflows
- Field names like `pain` / `proposed_fix` imply bug-fixing framing

This works for Team Reflectt (an engineering team). It won't work for agencies, retail ops, support teams, or mixed human+agent organizations.

## Design Principles

1. **Keep what works** — don't rename fields that are already generic enough
2. **Add flexibility, don't remove structure** — extend enums, don't flatten them
3. **Tag-driven taxonomy** — the tag system is already flexible; lean on it
4. **Domain presets, not domain locks** — ship preset tag taxonomies per vertical, but accept any tags

## Current Schema (v1)

### Reflection
```typescript
{
  pain: string,           // What hurts
  impact: string,         // What it affects
  evidence: string[],     // Proof
  went_well: string,      // Positive observations
  suspected_why: string,  // Root cause hypothesis
  proposed_fix: string,   // Suggested action
  confidence: number,     // 0-10
  role_type: 'human' | 'agent' | 'team',
  author: string,
  severity?: 'low' | 'medium' | 'high' | 'critical',
  tags?: string[],
  task_id?: string,
  team_id?: string,
}
```

### Insight Cluster Key
```typescript
{
  workflow_stage: string,   // e.g., "review", "deploy", "triage"
  failure_family: string,   // e.g., "runtime-error", "data-loss"
  impacted_unit: string,    // e.g., "cloud", "node", team_id
}
```

## Proposed Schema (v2) — Backward Compatible

### Reflection — No Breaking Changes

The reflection fields are actually already generic enough:
- `pain` → works for any domain ("customer complaints about wait times")
- `impact` → works ("revenue loss", "team morale")
- `evidence` → works (links, screenshots, data)
- `went_well` → works
- `suspected_why` → works
- `proposed_fix` → works ("hire more staff", "change supplier")

**One addition:** optional `domain` field for UI/routing hints:
```typescript
{
  // ... existing fields unchanged ...
  domain?: string,  // e.g., "engineering", "retail", "support", "ops", "agency"
}
```

### Insight Cluster Key — Rename for Clarity

Rename fields to be domain-neutral while keeping the same 3-axis structure:

| Current (v1) | Proposed (v2) | Why |
|---|---|---|
| `workflow_stage` | `process_stage` | "workflow" implies software; "process" is universal |
| `failure_family` | `pattern_family` | Not all insights are about failures; some are about opportunities, friction, or trends |
| `impacted_unit` | `scope_unit` | "impacted" implies damage; "scope" is neutral |

**Migration:** Accept both old and new field names. Map old→new internally. DB stores new names; API accepts either.

### Tag Taxonomy — Domain Presets

Current tag prefixes (`stage:`, `family:`, `unit:`) remain valid. Add domain-specific preset packs:

#### Engineering (current, unchanged)
```
stage:review, stage:deploy, stage:triage, stage:testing
family:runtime-error, family:data-loss, family:performance, family:ui
unit:cloud, unit:node, unit:api
```

#### Retail / Operations
```
stage:procurement, stage:inventory, stage:fulfillment, stage:returns
family:stockout, family:overstock, family:supplier-delay, family:quality-defect
unit:store-north, unit:warehouse, unit:online
```

#### Agency / Client Services
```
stage:brief, stage:creative, stage:review, stage:delivery
family:scope-creep, family:revision-loop, family:deadline-miss, family:budget-overrun
unit:client-acme, unit:client-globex, unit:internal
```

#### Support / Customer Success
```
stage:triage, stage:investigation, stage:resolution, stage:followup
family:recurring-issue, family:escalation, family:churn-signal, family:onboarding-friction
unit:tier-1, unit:tier-2, unit:enterprise
```

### Inference Engine — Pattern Matching by Domain

The current `_inferFailureFamily()` only matches software patterns. Generalize to a pluggable inference system:

```typescript
interface DomainInferenceEngine {
  domain: string
  inferPatternFamily(text: string): string
  inferProcessStage(text: string): string
  inferScopeUnit(text: string, context: { team_id?: string }): string
}

// Default engine: current engineering patterns
// Additional engines: registered per-domain
const engines: Map<string, DomainInferenceEngine> = new Map()
```

**v2 implementation:** Keep the current engineering inference as default. Add a `domain` hint in the reflection. If `domain` is set and an engine exists, use it. Otherwise fall back to the default.

This is NOT a rewrite — it's wrapping the existing `_inferFailureFamily` in a pluggable pattern.

### Promotion Gate — Already Generic

The promotion gate is already domain-agnostic:
- `>= 2 independent reflections (different authors)` — works for any team
- `OR 1 high/critical severity with evidence` — works for any domain
- 24h cooldown — works universally

**No changes needed.**

## Non-SaaS Examples

### Example 1: Retail Chain — Stockout Pattern

**Reflection:**
```json
{
  "pain": "Store #12 ran out of winter jackets 3 weeks before season end",
  "impact": "Estimated $15k lost revenue, customer complaints on social media",
  "evidence": ["inventory-report-2026-01.pdf", "social-mention-screenshot.png"],
  "went_well": "Store #8 had surplus and could transfer partial stock",
  "suspected_why": "Demand forecast model underweighted social media trend signals",
  "proposed_fix": "Add social trend input to demand forecasting pipeline",
  "confidence": 7,
  "role_type": "human",
  "author": "maria-ops",
  "severity": "high",
  "domain": "retail",
  "tags": ["stage:procurement", "family:stockout", "unit:store-12"]
}
```

**Insight cluster:** `procurement::stockout::store-12`  
**Promotion:** If another store reports similar stockout → auto-promotes to task  

### Example 2: Agency — Revision Loop

**Reflection:**
```json
{
  "pain": "Acme Corp creative went through 7 revision rounds before approval",
  "impact": "3 weeks over deadline, $8k budget overrun, designer burnout",
  "evidence": ["acme-timeline.md", "budget-tracker-link"],
  "went_well": "Client ultimately happy with final output",
  "suspected_why": "Brief was too vague — 'make it pop' led to interpretation drift",
  "proposed_fix": "Require structured brief template with visual references before creative starts",
  "confidence": 8,
  "role_type": "human",
  "author": "alex-creative-lead",
  "severity": "medium",
  "domain": "agency",
  "tags": ["stage:creative", "family:revision-loop", "unit:client-acme"]
}
```

**Insight cluster:** `creative::revision-loop::client-acme`  
**Promotion:** If another project hits 5+ revisions → cross-validates the brief problem  

### Example 3: Mixed Human+Agent Support Team

**Reflection:**
```json
{
  "pain": "AI agent resolved ticket #4521 incorrectly — told customer feature exists when it doesn't",
  "impact": "Customer escalated to human, trust in AI support reduced",
  "evidence": ["ticket-4521-transcript", "product-feature-matrix.md"],
  "went_well": "Human agent caught the error within 10 minutes via quality review",
  "suspected_why": "Agent knowledge base out of date — feature was deprecated last sprint",
  "proposed_fix": "Auto-sync agent knowledge base on each product release",
  "confidence": 9,
  "role_type": "agent",
  "author": "support-bot-v3",
  "severity": "high",
  "domain": "support",
  "tags": ["stage:resolution", "family:recurring-issue", "unit:tier-1"]
}
```

**Insight cluster:** `resolution::recurring-issue::tier-1`  
**Promotion:** High severity + evidence → immediate promotion to task  

## Risks & Edge Cases

### 1. Unknown domains default gracefully
If `domain` is omitted or unrecognized, the system falls back to the current engineering inference. No breakage.

### 2. Mixed-domain teams
A team might have both engineering and ops reflections. The `domain` field per-reflection (not per-team) handles this. Insights cluster by tag, not by domain — two reflections from different domains can cluster if they share the same tag structure.

### 3. Tag sprawl
Without guidance, teams will create inconsistent tags. **Mitigation:** Domain presets provide suggested taxonomies. The UI can offer autocomplete from the preset + previously-used tags. No enforcement — tags are always freeform.

### 4. Cluster key collision across domains
`review::quality-defect::team-a` might mean different things in engineering vs retail. **Mitigation:** The `domain` field disambiguates at the reflection level. If needed, cluster keys can be prefixed with domain in v3, but v2 relies on tags being specific enough.

### 5. Inference accuracy for non-engineering text
`_inferFailureFamily("customer complaints about wait times")` returns `uncategorized` today. **Mitigation:** The domain engine system means retail/support teams get domain-specific inference. Without a domain engine, tags are the primary clustering mechanism (which is already the design).

### 6. Backward compatibility
No existing reflections or insights break. The `domain` field is optional. The cluster key rename is additive (accept old names, store new). Existing tags continue to work.

## Implementation Plan

| Step | Change | Risk | LOE |
|---|---|---|---|
| 1 | Add optional `domain` field to Reflection schema + validation | None | 15min |
| 2 | Rename cluster key fields (accept both old/new) | Low — internal only | 30min |
| 3 | Add domain preset tag packs (static JSON) | None | 20min |
| 4 | Add `GET /reflections/schema?domain=retail` for domain-specific field hints | None | 15min |
| 5 | Pluggable inference engine interface + engineering default | Low | 30min |
| 6 | Retail + agency + support inference engines | None | 45min |

**Total estimate:** ~2.5h across 2-3 PRs

## Decision Needed

- **Do we ship the `domain` field and tag presets now?** (Low-risk, high-value for positioning)
- **Do we rename cluster key fields?** (Internal change, worth doing while pipeline is young)
- **Do we build domain inference engines?** (Can defer — tags already handle clustering)

Recommendation: Ship steps 1-4 now (1h). Steps 5-6 when a non-engineering team actually onboards.
