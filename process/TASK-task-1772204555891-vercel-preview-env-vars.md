# Vercel Preview Env Vars Fix

**Task:** task-1772204555891-kdw92lnf5
**Date:** 2026-02-28
**Author:** rhythm

## Problem

Vercel preview deployments for `reflectt-cloud` showed "Supabase env vars missing" banner, blocking `/welcome` and `/share` rendering. This prevented proof screenshots and broke onboarding in preview environments.

## Root Cause

All 17 environment variables on the `reflectt-cloud` Vercel project were configured with `target: ["production"]` only. Preview deployments received zero env vars.

## Fix

Updated all 17 env vars to target both production and preview via Vercel API:

```
PATCH /v9/projects/reflectt-cloud/env/:id?teamId=team_ptvQX3qNDayCIgNzwXdetkOK
Body: {"target": ["production", "preview"]}
```

### Env vars updated:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
- SUPABASE_JWT_SECRET, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_API_BASE_URL
- POSTGRES_URL, POSTGRES_PRISMA_URL, POSTGRES_URL_NON_POOLING
- POSTGRES_USER, POSTGRES_HOST, POSTGRES_PASSWORD, POSTGRES_DATABASE

## Verification

Redeployed preview `reflectt-cloud-mbn4dmu5a-reflecttai.vercel.app`:
- `/welcome` returns `<title>Reflectt Cloud</title>` — no env-missing banner
- 0 matches for "env missing" / "supabase missing" in HTML

## Note

Existing preview deployments need a redeploy to pick up env vars. New deploys get them automatically.
