# Vercel Preview Access Fix

**Task:** task-1772253849326-73i0prpif
**Date:** 2026-02-28
**Author:** rhythm

## Problem

Vercel preview deployment URLs for `reflectt-cloud` redirected to Vercel SSO login, blocking:
- Proof screenshot automation
- Agent review of preview deploys
- Any non-team-member preview access

## Root Cause

`ssoProtection` was configured with `deploymentType: "all_except_custom_domains"` on the `reflectt-cloud` Vercel project. This forced Vercel authentication on all non-custom-domain URLs, including preview deployments.

## Fix

Disabled `ssoProtection` via Vercel REST API:

```
PATCH /v9/projects/reflectt-cloud?teamId=team_ptvQX3qNDayCIgNzwXdetkOK
Body: {"ssoProtection": null}
```

The app has its own authentication via Supabase — Vercel SSO on previews was redundant.

## Verification

Preview URL `reflectt-cloud-a6h3uynkr-reflecttai.vercel.app` (PR #269):
- Returns HTTP 307 → `/auth` (app's own auth middleware, not Vercel login)
- No Vercel SSO redirect
- App HTML renders correctly

## Related

- **task-1772204555891**: Supabase env vars missing in preview — all env vars are set for `production` target only, not `preview`. Separate fix needed.

## Rollback

To re-enable SSO protection:
```
PATCH /v9/projects/reflectt-cloud
Body: {"ssoProtection": {"deploymentType": "all_except_custom_domains"}}
```
