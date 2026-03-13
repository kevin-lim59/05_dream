-- dream_memory.sql
-- Schema for dream-memory archive + candidate + promotion persistence.
-- Intended for the self-hosted 03_supabase project.

create extension if not exists pgcrypto;

create table if not exists public.dream_jobs (
  id uuid primary key default gen_random_uuid(),
  job_date date not null unique,
  status text not null default 'archiving',
  sessions_discovered integer not null default 0,
  sessions_archived integer not null default 0,
  sessions_promoted integer not null default 0,
  sessions_failed integer not null default 0,
  notes jsonb not null default '{}'::jsonb,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dream_jobs_status_check check (status in ('archiving', 'archived', 'analyzed', 'promoted', 'failed'))
);

create table if not exists public.dream_sessions (
  id uuid primary key default gen_random_uuid(),
  external_session_id text not null unique,
  job_id uuid references public.dream_jobs(id) on delete set null,
  channel text not null default 'unknown',
  agent_name text not null default 'miku',
  started_at timestamptz,
  ended_at timestamptz,
  last_message_at timestamptz,
  message_count integer not null default 0,
  char_count integer not null default 0,
  archive_status text not null default 'archived',
  analysis_status text not null default 'analyzed',
  promotion_status text not null default 'none',
  importance_score integer not null default 0,
  importance_band text not null default 'low',
  retention_class text not null default 'standard',
  summary_short text,
  summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dream_sessions_archive_status_check check (archive_status in ('archiving', 'archived', 'failed')),
  constraint dream_sessions_analysis_status_check check (analysis_status in ('pending', 'analyzed', 'failed')),
  constraint dream_sessions_promotion_status_check check (promotion_status in ('promoted', 'review_later', 'archived_only', 'none')),
  constraint dream_sessions_importance_band_check check (importance_band in ('low', 'medium', 'high')),
  constraint dream_sessions_retention_class_check check (retention_class in ('ephemeral', 'standard', 'promoted'))
);

create index if not exists dream_sessions_job_id_idx on public.dream_sessions(job_id);
create index if not exists dream_sessions_last_message_at_idx on public.dream_sessions(last_message_at desc);
create index if not exists dream_sessions_promotion_status_idx on public.dream_sessions(promotion_status);

create table if not exists public.dream_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.dream_sessions(id) on delete cascade,
  external_message_id text,
  seq_no integer not null,
  role text not null,
  author_name text,
  created_at timestamptz,
  content_text text,
  content_json jsonb not null default '{}'::jsonb,
  attachment_count integer not null default 0,
  sensitivity text not null default 'unknown',
  inserted_at timestamptz not null default now(),
  unique(session_id, seq_no),
  constraint dream_messages_role_check check (role in ('system', 'developer', 'user', 'assistant', 'tool')),
  constraint dream_messages_sensitivity_check check (sensitivity in ('unknown', 'low', 'medium', 'high'))
);

create index if not exists dream_messages_session_id_idx on public.dream_messages(session_id, seq_no);
create index if not exists dream_messages_external_message_id_idx on public.dream_messages(external_message_id);

create table if not exists public.dream_memory_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.dream_sessions(id) on delete cascade,
  kind text not null,
  title text not null,
  summary text,
  detail_json jsonb not null default '{}'::jsonb,
  confidence_score numeric(6,4) not null default 0,
  importance_score integer not null default 0,
  novelty_score numeric(6,4) not null default 0,
  actionability_score numeric(6,4) not null default 0,
  decision text not null default 'archive_only',
  reason_codes jsonb not null default '[]'::jsonb,
  source_message_ids jsonb not null default '[]'::jsonb,
  content_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, kind, title),
  constraint dream_memory_candidates_kind_check check (kind in ('fact', 'operation_rule', 'decision', 'project_state')),
  constraint dream_memory_candidates_decision_check check (decision in ('promote', 'defer', 'archive_only', 'reject'))
);

create index if not exists dream_memory_candidates_session_id_idx on public.dream_memory_candidates(session_id);
create index if not exists dream_memory_candidates_decision_idx on public.dream_memory_candidates(decision);
create index if not exists dream_memory_candidates_fingerprint_idx on public.dream_memory_candidates(content_fingerprint);

create table if not exists public.dream_promotions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.dream_memory_candidates(id) on delete cascade,
  session_id uuid not null references public.dream_sessions(id) on delete cascade,
  target_file text not null,
  target_section text,
  entry_slug text not null,
  promotion_mode text not null default 'append',
  content_markdown text not null,
  source_refs_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, entry_slug),
  constraint dream_promotions_mode_check check (promotion_mode in ('append', 'replace', 'merge'))
);

create index if not exists dream_promotions_candidate_id_idx on public.dream_promotions(candidate_id);
create index if not exists dream_promotions_session_id_idx on public.dream_promotions(session_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_dream_jobs_updated_at on public.dream_jobs;
create trigger set_dream_jobs_updated_at
before update on public.dream_jobs
for each row execute function public.set_updated_at();

drop trigger if exists set_dream_sessions_updated_at on public.dream_sessions;
create trigger set_dream_sessions_updated_at
before update on public.dream_sessions
for each row execute function public.set_updated_at();

drop trigger if exists set_dream_memory_candidates_updated_at on public.dream_memory_candidates;
create trigger set_dream_memory_candidates_updated_at
before update on public.dream_memory_candidates
for each row execute function public.set_updated_at();

drop trigger if exists set_dream_promotions_updated_at on public.dream_promotions;
create trigger set_dream_promotions_updated_at
before update on public.dream_promotions
for each row execute function public.set_updated_at();

alter table public.dream_jobs enable row level security;
alter table public.dream_sessions enable row level security;
alter table public.dream_messages enable row level security;
alter table public.dream_memory_candidates enable row level security;
alter table public.dream_promotions enable row level security;

-- Service-role-only writes for v0. Reads can be widened later if a dashboard appears.
grant usage on schema public to service_role;
grant all on public.dream_jobs to service_role;
grant all on public.dream_sessions to service_role;
grant all on public.dream_messages to service_role;
grant all on public.dream_memory_candidates to service_role;
grant all on public.dream_promotions to service_role;

drop policy if exists "service role full access dream_jobs" on public.dream_jobs;
create policy "service role full access dream_jobs"
  on public.dream_jobs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role full access dream_sessions" on public.dream_sessions;
create policy "service role full access dream_sessions"
  on public.dream_sessions
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role full access dream_messages" on public.dream_messages;
create policy "service role full access dream_messages"
  on public.dream_messages
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role full access dream_memory_candidates" on public.dream_memory_candidates;
create policy "service role full access dream_memory_candidates"
  on public.dream_memory_candidates
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role full access dream_promotions" on public.dream_promotions;
create policy "service role full access dream_promotions"
  on public.dream_promotions
  for all
  to service_role
  using (true)
  with check (true);
