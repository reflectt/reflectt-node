# Task State Migration: local JSONL → Supabase

This enables persistent, cloud-visible task state for reflectt-node while preserving offline local JSON behavior.

## What ships

- Supabase table schema for task state:
  - `docs/sql/20260215_tasks_state_supabase.sql`
- Optional task-state adapter in runtime:
  - `src/taskStateSync.ts`
- Local→cloud migration script:
  - `tools/migrate-tasks-to-supabase.ts`

## Runtime behavior

- reflectt-node still writes local JSONL (`~/.reflectt/data/tasks.jsonl`) first.
- If Supabase env vars are configured, task create/update/delete is mirrored to Supabase.
- If Supabase is unavailable/offline, reflectt-node continues with local JSON only (graceful fallback).
- On startup, if local tasks are empty and cloud state exists, reflectt-node hydrates local JSON from Supabase.

## Required env vars

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
# optional
REFLECTT_TASKS_TABLE=tasks
```

## One-time migration steps

1. Apply SQL schema in Supabase:
   - run `docs/sql/20260215_tasks_state_supabase.sql`

2. Export env vars in your reflectt-node environment.

3. Run migration script:

```bash
npm run tasks:migrate:supabase
```

4. Verify rows exist in `public.tasks`.

## Rollback / safety

- Removing Supabase env vars reverts runtime behavior to local JSONL only.
- Local JSON remains source of continuity during network outages.
