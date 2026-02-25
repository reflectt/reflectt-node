# Overclaims Audit: Approvals + Canvas

**Task:** task-1771972158086-qahxxxn24
**Author:** link
**Date:** 2026-02-25

## Locations Checked

| Location | Path | Approvals? | Canvas? |
|----------|------|------------|---------|
| reflectt-node docs | `public/docs.md` | ✅ Lines 404-407, 693, 708-710 — API endpoints documented | ✅ Lines 566-571 — API endpoints documented |
| reflectt-node README | `README.md` | ❌ No mention | ❌ No mention |
| reflectt-cloud sidebar | `apps/web/src/app/(app)/sidebar.tsx:25` | ✅ Nav item `{ href: '/approvals', label: 'Approvals' }` | ❌ No nav entry |
| reflectt-cloud approvals page | `apps/web/src/app/(app)/approvals/` | ✅ Full 686-line functional page + API route | N/A |
| reflectt-cloud canvas components | `apps/web/src/app/(app)/canvas/` | N/A | ⚠️ Components exist (`agent-lane.tsx`, `canvas-view.tsx`) but **no page route** |
| reflectt.ai marketing | `app/page.tsx:271` | ✅ Sidebar mockup includes "Approvals" | ❌ No mention |
| reflectt.ai marketing copy | `app/page.tsx` | ❌ No "human approval queue" claims | ❌ No "real-time canvas" claims |
| forAgents.dev | All `.tsx` files | ❌ No mention | ❌ No mention |

## Assessment

### Approvals: NOT an overclaim ✅
The approvals system is **shipped and functional**:
- Node: `routing-approvals.ts` with full API (`GET /routing/approvals`, `POST /routing/approvals/:taskId/decide`, `POST /routing/approvals/suggest`)
- Cloud: 686-line `approvals-client.tsx` with confidence scoring, reasoning display, approve/reject UI
- Sidebar nav item correctly points to working page

**Decision: Keep as-is.** No copy changes needed.

### Canvas: NOT currently overclaimed ✅
- Node endpoints exist and work (`/canvas/render`, `/canvas/slots`, `/canvas/stream`)
- Cloud has internal components but **no page route and no sidebar nav entry**
- Marketing makes no canvas claims
- No user can accidentally navigate to a broken canvas page

**Decision: Canvas is internal-only. If exposed post-login, label as "beta."** No copy changes needed now.

### Marketing sidebar mockup
Line 271 shows `['Overview', 'Tasks', 'Agents', 'Hosts', 'Approvals']` in a UI mockup. This is accurate since Approvals is shipped.

## Replacement Copy (if needed in future)

If Canvas gets added to sidebar before it's production-ready:
```tsx
// In NAV_ITEMS:
{ href: '/canvas', label: 'Canvas (beta)', icon: '□' },
```

If Approvals were removed/broken, replace marketing mockup:
```tsx
// In app/page.tsx line 271:
{['Overview', 'Tasks', 'Agents', 'Hosts'].map((item, i) => (
```

## Summary

**No overclaims found.** Both features are either shipped (Approvals) or correctly hidden (Canvas). No copy changes required.
