# Proof — task-1771077041839-cacvv8myq (Promotion SSOT Dashboard Card)

## Change Summary
Added a new dashboard panel card: **🧭 Promotion SSOT** with quick links to promotion-day SSOT resources.

## Implementation
- File updated: `src/dashboard.ts`
- Added:
  - `SSOT_LINKS` data model
  - `renderPromotionSSOT()` renderer
  - panel markup (`#ssot-body`, `#ssot-count`)
  - card styles (`.ssot-*`)
- Refresh integration:
  - `renderPromotionSSOT()` runs from `refresh()` after existing panel loads.

## Placement / Priority
- New panel inserted under **Collaboration Compliance** and above Chat/Activity split.
- Keeps operational docs accessible without displacing critical health/compliance widgets.

## Link Targets Exposed
- Promotion Evidence Index
- Promotion Day Quickstart
- Live Promotion Checklist
- Required-Check Runbook
- Promotion Run-Window + Comms
- Promotion-Day Smoke Script
- Rollback Drill Notes (pending) → intentional missing-state row

## Interaction + Missing-Target Fallback
- Valid targets render as `Open` links (`target="_blank"`).
- Missing target renders non-clickable `missing` badge.
- Card remains functional even if one row is missing.

## Validation Evidence
Browser evaluation result (post-restart):
- `ssotCount`: `6/7 links`
- `linkCount`: `6`
- `missingCount`: `1`
- first links present and clickable
- existing sections intact:
  - `chat=true`
  - `health=true`
  - `compliance=true`
- clock + refresh loop active (`clock` populated, `hasRefresh=function`)

Screenshot capture:
- `MEDIA:/Users/ryan/.openclaw/media/browser/cf199fb4-ed8b-4738-b489-bec410094545.jpg`

## Accessibility Notes
- Focus-visible style added for SSOT links.
- Readable labels use human titles (not raw filenames only).
- Missing state includes text badge (`missing`) not color-only indication.
