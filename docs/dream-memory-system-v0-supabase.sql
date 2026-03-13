-- Dream Memory System v0
-- Supabase / Postgres draft schema
-- Based on: dream-memory-system-v0.md
-- Notes:
--   * raw archive is the source of truth for replay/audit
--   * markdown memory files remain outside DB
--   * status/band/decision values use text + check constraints for v0 simplicity
--   * no complex RLS/policy included in this draft

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Utility: updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
'Sets updated_at = now() before update for Dream Memory System tables.';

-- ---------------------------------------------------------------------------
-- dream_jobs
-- ---------------------------------------------------------------------------

create table if not exists public.dream_jobs (
  id uuid primary key default gen_random_uuid(),
  job_date date not null,
  status text not null default 'running'
    check (
      status in (
        'running',
        'discovering',
        'archiving',
        'analyzing',
        'promoting',
        'forgetting',
        'completed',
        'partial',
        'failed'
      )
    ),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  lock_key text,
  sessions_discovered integer not null default 0 check (sessions_discovered >= 0),
  sessions_archived integer not null default 0 check (sessions_archived >= 0),
  sessions_promoted integer not null default 0 check (sessions_promoted >= 0),
  sessions_failed integer not null default 0 check (sessions_failed >= 0),
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dream_jobs_job_date_key unique (job_date),
  constraint dream_jobs_lock_key_key unique (lock_key)
);

comment on table public.dream_jobs is
'Nightly Dream Memory batch job runs, one logical job per target KST date.';
comment on column public.dream_jobs.job_date is
'Target date being processed (typically yesterday in Asia/Seoul).' ;
comment on column public.dream_jobs.status is
'Job lifecycle state for observability and replay.';
comment on column public.dream_jobs.lock_key is
'Optional idempotency / concurrency control key such as dream-job:2026-03-12.';
comment on column public.dream_jobs.notes is
'JSON metadata for errors, counts, versions, and debug details.';

create index if not exists idx_dream_jobs_status on public.dream_jobs (status);
create index if not exists idx_dream_jobs_started_at on public.dream_jobs (started_at desc);

create trigger trg_dream_jobs_set_updated_at
before update on public.dream_jobs
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- dream_sessions
-- ---------------------------------------------------------------------------

create table if not exists public.dream_sessions (
  id uuid primary key default gen_random_uuid(),
  external_session_id text not null,
  job_id uuid references public.dream_jobs(id) on delete set null,
  channel text not null
    check (channel in ('discord', 'cli', 'telegram', 'web', 'api', 'unknown')),
  agent_name text,
  user_id text,
  started_at timestamptz,
  ended_at timestamptz,
  last_message_at timestamptz,
  message_count integer not null default 0 check (message_count >= 0),
  tool_call_count integer not null default 0 check (tool_call_count >= 0),
  char_count integer not null default 0 check (char_count >= 0),
  transcript_checksum text,
  archive_status text not null default 'pending'
    check (archive_status in ('pending', 'archived', 'failed')),
  analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'analyzed', 'failed')),
  promotion_status text not null default 'none'
    check (promotion_status in ('none', 'promoted', 'review_later', 'archived_only', 'failed')),
  importance_score numeric(5,2)
    check (importance_score is null or (importance_score >= 0 and importance_score <= 100)),
  importance_band text
    check (importance_band is null or importance_band in ('low', 'medium', 'high', 'critical')),
  retention_class text
    check (retention_class is null or retention_class in ('ephemeral', 'standard', 'promoted', 'sensitive_hold')),
  purge_after timestamptz,
  purged_at timestamptz,
  storage_path text,
  summary_short text,
  summary_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dream_sessions_external_session_id_key unique (external_session_id),
  constraint dream_sessions_time_order_check check (
    ended_at is null
    or started_at is null
    or ended_at >= started_at
  ),
  constraint dream_sessions_purge_order_check check (
    purged_at is null
    or purge_after is null
    or purged_at >= purge_after
  )
);

comment on table public.dream_sessions is
'Archived session metadata plus processing state, scoring, retention, and provenance pointers.';
comment on column public.dream_sessions.external_session_id is
'Original OpenClaw session identifier; used as the primary dedupe key.';
comment on column public.dream_sessions.job_id is
'Last/owning job that processed this session. Nullable to preserve metadata if a job row is removed.';
comment on column public.dream_sessions.archive_status is
'Raw transcript archiving state.';
comment on column public.dream_sessions.analysis_status is
'Analysis stage state (summary, scoring, candidate extraction).' ;
comment on column public.dream_sessions.promotion_status is
'Memory promotion outcome at session level.';
comment on column public.dream_sessions.importance_score is
'0..100 session importance score for v0 ranking and retention rules.';
comment on column public.dream_sessions.importance_band is
'Band derived from importance_score: low/medium/high/critical.';
comment on column public.dream_sessions.retention_class is
'High-level retention bucket controlling purge_after policy.';
comment on column public.dream_sessions.storage_path is
'Storage object path for full transcript JSONL/GZIP when kept outside row storage.';
comment on column public.dream_sessions.summary_json is
'Structured summary, entities, decisions, and intermediate analysis output.';

create index if not exists idx_dream_sessions_job_id on public.dream_sessions (job_id);
create index if not exists idx_dream_sessions_last_message_at on public.dream_sessions (last_message_at desc);
create index if not exists idx_dream_sessions_started_at on public.dream_sessions (started_at desc);
create index if not exists idx_dream_sessions_archive_status on public.dream_sessions (archive_status);
create index if not exists idx_dream_sessions_analysis_status on public.dream_sessions (analysis_status);
create index if not exists idx_dream_sessions_promotion_status on public.dream_sessions (promotion_status);
create index if not exists idx_dream_sessions_importance_band_retention_class
  on public.dream_sessions (importance_band, retention_class);
create index if not exists idx_dream_sessions_purge_after
  on public.dream_sessions (purge_after)
  where purge_after is not null and purged_at is null;
create index if not exists idx_dream_sessions_checksum
  on public.dream_sessions (transcript_checksum)
  where transcript_checksum is not null;

create trigger trg_dream_sessions_set_updated_at
before update on public.dream_sessions
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- dream_messages
-- ---------------------------------------------------------------------------

create table if not exists public.dream_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.dream_sessions(id) on delete cascade,
  external_message_id text,
  seq_no integer not null check (seq_no > 0),
  role text not null
    check (role in ('system', 'developer', 'user', 'assistant', 'tool')),
  author_name text,
  created_at timestamptz,
  content_text text,
  content_json jsonb,
  tool_name text,
  tool_call_id text,
  attachment_count integer not null default 0 check (attachment_count >= 0),
  attachment_json jsonb,
  tokens_estimate integer check (tokens_estimate is null or tokens_estimate >= 0),
  sensitivity text not null default 'unknown'
    check (sensitivity in ('unknown', 'low', 'pii_possible', 'secret_possible')),
  storage_overflow_path text,
  created_row_at timestamptz not null default now(),
  constraint dream_messages_session_seq_key unique (session_id, seq_no)
);

comment on table public.dream_messages is
'Raw message-level archive for each Dream session, preserving order and lightweight tool metadata.';
comment on column public.dream_messages.seq_no is
'1-based stable sequence number within a session. Required for transcript reconstruction.';
comment on column public.dream_messages.content_json is
'Optional rich payload for structured content, blocks, or provider-specific fields.';
comment on column public.dream_messages.tool_name is
'First-class tool name when the message corresponds to a tool call/output.';
comment on column public.dream_messages.sensitivity is
'Coarse v0 classifier for privacy/secret handling heuristics.';
comment on column public.dream_messages.storage_overflow_path is
'Pointer for oversized payloads stored outside the row.';

create index if not exists idx_dream_messages_session_created_at
  on public.dream_messages (session_id, created_at);
create index if not exists idx_dream_messages_external_message_id
  on public.dream_messages (external_message_id)
  where external_message_id is not null;
create index if not exists idx_dream_messages_role on public.dream_messages (role);
create index if not exists idx_dream_messages_tool_name
  on public.dream_messages (tool_name)
  where tool_name is not null;
create index if not exists idx_dream_messages_sensitivity on public.dream_messages (sensitivity);

-- ---------------------------------------------------------------------------
-- dream_memory_candidates
-- ---------------------------------------------------------------------------

create table if not exists public.dream_memory_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.dream_sessions(id) on delete cascade,
  kind text not null
    check (
      kind in (
        'project_state',
        'user_preference',
        'decision',
        'operation_rule',
        'fact',
        'relationship',
        'todo'
      )
    ),
  title text not null,
  summary text not null,
  detail_json jsonb not null default '{}'::jsonb,
  confidence_score numeric(5,2)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  importance_score numeric(5,2)
    check (importance_score is null or (importance_score >= 0 and importance_score <= 100)),
  novelty_score numeric(5,2)
    check (novelty_score is null or (novelty_score >= 0 and novelty_score <= 100)),
  actionability_score numeric(5,2)
    check (actionability_score is null or (actionability_score >= 0 and actionability_score <= 100)),
  decision text not null default 'defer'
    check (decision in ('promote', 'defer', 'archive_only', 'reject')),
  reason_codes text[] not null default '{}'::text[],
  source_message_ids text[] not null default '{}'::text[],
  content_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dream_memory_candidates_session_kind_title_key unique (session_id, kind, title)
);

comment on table public.dream_memory_candidates is
'Candidate long-term memories extracted from a single session before actual markdown promotion.';
comment on column public.dream_memory_candidates.kind is
'Domain type used to route the candidate into MEMORY.md or memory/* files.';
comment on column public.dream_memory_candidates.detail_json is
'Optional structured details such as entities, project keys, or normalized facts.';
comment on column public.dream_memory_candidates.confidence_score is
'v0 confidence value normalized to 0.00..1.00.';
comment on column public.dream_memory_candidates.decision is
'Initial routing decision: promote/defer/archive_only/reject.';
comment on column public.dream_memory_candidates.reason_codes is
'Human-readable reason tags explaining why the candidate matters.';
comment on column public.dream_memory_candidates.source_message_ids is
'Original message ids or sequence refs supporting provenance and review.';
comment on column public.dream_memory_candidates.content_fingerprint is
'Optional hash/fingerprint for smarter dedupe across re-analysis.';

create index if not exists idx_dream_memory_candidates_session_id
  on public.dream_memory_candidates (session_id);
create index if not exists idx_dream_memory_candidates_kind_decision
  on public.dream_memory_candidates (kind, decision);
create index if not exists idx_dream_memory_candidates_importance_score
  on public.dream_memory_candidates (importance_score desc);
create index if not exists idx_dream_memory_candidates_content_fingerprint
  on public.dream_memory_candidates (content_fingerprint)
  where content_fingerprint is not null;

create trigger trg_dream_memory_candidates_set_updated_at
before update on public.dream_memory_candidates
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- dream_promotions
-- ---------------------------------------------------------------------------

create table if not exists public.dream_promotions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.dream_memory_candidates(id) on delete cascade,
  session_id uuid not null references public.dream_sessions(id) on delete cascade,
  target_file text not null,
  target_section text,
  entry_slug text not null,
  promotion_mode text not null default 'append'
    check (promotion_mode in ('append', 'merge', 'replace')),
  content_markdown text not null,
  source_refs_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dream_promotions_candidate_id_key unique (candidate_id),
  constraint dream_promotions_session_slug_key unique (session_id, entry_slug)
);

comment on table public.dream_promotions is
'Actual markdown promotion records written to MEMORY.md or memory/* files.';
comment on column public.dream_promotions.target_file is
'Relative or absolute markdown file path updated by the promotion step.';
comment on column public.dream_promotions.entry_slug is
'Dedupe/merge key, e.g. project:03_voxie:active-priorities.';
comment on column public.dream_promotions.promotion_mode is
'How the markdown file was updated: append, merge, or replace.';
comment on column public.dream_promotions.content_markdown is
'Exact markdown block written at promotion time for replay/audit.';
comment on column public.dream_promotions.source_refs_json is
'Provenance payload including session/message refs and timestamps.';

create index if not exists idx_dream_promotions_session_id
  on public.dream_promotions (session_id);
create index if not exists idx_dream_promotions_target_file
  on public.dream_promotions (target_file);
create index if not exists idx_dream_promotions_entry_slug
  on public.dream_promotions (entry_slug);

create trigger trg_dream_promotions_set_updated_at
before update on public.dream_promotions
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Optional helpful view for quick ops/debugging
-- ---------------------------------------------------------------------------

create or replace view public.dream_session_overview as
select
  s.id,
  s.external_session_id,
  s.channel,
  s.agent_name,
  s.last_message_at,
  s.message_count,
  s.archive_status,
  s.analysis_status,
  s.promotion_status,
  s.importance_score,
  s.importance_band,
  s.retention_class,
  s.purge_after,
  s.purged_at,
  j.job_date,
  j.status as job_status
from public.dream_sessions s
left join public.dream_jobs j on j.id = s.job_id;

comment on view public.dream_session_overview is
'Convenience view for ops/debugging across session state and owning job state.';
