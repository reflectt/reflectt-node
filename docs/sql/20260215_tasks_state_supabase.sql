-- Reflectt Node persistent task state table (v1)
-- Run in your reflectt-cloud Supabase project

create table if not exists public.tasks (
  id text primary key,
  title text not null,
  description text,
  status text not null check (status in ('todo', 'doing', 'blocked', 'validating', 'done')),
  assignee text,
  reviewer text,
  done_criteria jsonb,
  created_by text not null,
  created_at bigint not null,
  updated_at bigint not null,
  priority text check (priority in ('P0', 'P1', 'P2', 'P3')),
  blocked_by jsonb,
  epic_id text,
  tags jsonb,
  metadata jsonb,
  raw jsonb not null default '{}'::jsonb
);

create index if not exists idx_tasks_updated_at on public.tasks (updated_at desc);
create index if not exists idx_tasks_status on public.tasks (status);
create index if not exists idx_tasks_assignee on public.tasks (assignee);
