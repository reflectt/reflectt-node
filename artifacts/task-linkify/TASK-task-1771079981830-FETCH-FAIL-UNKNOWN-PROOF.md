# Forced Fetch-Fail Proof — task-1771079981830-8x3kfxpz5

## Patch Summary
Removed fixed fallback timestamp behavior for unavailable/unparseable metadata.

- Updated file: `src/dashboard.ts`
- Behavior now:
  - on fetch failure or parse miss => `lastVerifiedUtc: null`
  - render state resolves to `unknown`
  - display text: `verification timestamp unavailable`

## Forced-Fail Validation
Method:
- monkey-patched `window.fetch` in browser runtime to reject requests for SSOT index raw URL
- reset SSOT cache
- re-rendered Promotion SSOT card

Observed result:
- `text`: `verification timestamp unavailable`
- `badge`: `unknown`
- `badgeClass`: `ssot-state-badge unknown`

Screenshot proof:
- `MEDIA:/Users/ryan/.openclaw/media/browser/1b515501-9b24-4ce5-af0b-0c8ec4ec54ad.jpg`

## Outcome
FAIL gate condition addressed:
1) fixed-time fallback removed ✅
2) explicit unknown state shown ✅
3) forced-fetch-fail proof captured ✅
