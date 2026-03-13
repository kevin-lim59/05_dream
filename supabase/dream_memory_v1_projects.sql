-- dream_memory_v1_projects.sql
-- Project-aware schema extension for dream-memory v1.
-- Intended to layer on top of supabase/dream_memory.sql.

create table if not exists public.dream_projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null default 'unknown',
  repo_url text,
  homepage_url text,
  description text,
  aliases_json jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dream_projects_kind_check check (kind in ('app', 'library', 'infra', 'personal', 'research', 'unknown')),
  constraint dream_projects_status_check check (status in ('active', 'paused', 'archived', 'unknown'))
);

create index if not exists dream_projects_kind_idx on public.dream_projects(kind);
create index if not exists dream_projects_status_idx on public.dream_projects(status);

create table if not exists public.dream_session_projects (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.dream_sessions(id) on delete cascade,
  project_id uuid not null references public.dream_projects(id) on delete cascade,
  link_source text not null default 'inferred',
  confidence_score numeric(6,4) not null default 0,
  primary_project boolean not null default false,
  reason_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(session_id, project_id),
  constraint dream_session_projects_link_source_check check (link_source in ('explicit', 'inferred', 'manual', 'imported'))
);

create index if not exists dream_session_projects_session_id_idx on public.dream_session_projects(session_id);
create index if not exists dream_session_projects_project_id_idx on public.dream_session_projects(project_id);
create index if not exists dream_session_projects_primary_project_idx on public.dream_session_projects(session_id, primary_project);

create table if not exists public.dream_candidate_projects (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.dream_memory_candidates(id) on delete cascade,
  project_id uuid not null references public.dream_projects(id) on delete cascade,
  link_source text not null default 'inherited',
  confidence_score numeric(6,4) not null default 0,
  reason_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(candidate_id, project_id),
  constraint dream_candidate_projects_link_source_check check (link_source in ('explicit', 'inherited', 'manual', 'imported'))
);

create index if not exists dream_candidate_projects_candidate_id_idx on public.dream_candidate_projects(candidate_id);
create index if not exists dream_candidate_projects_project_id_idx on public.dream_candidate_projects(project_id);

-- updated_at trigger for dream_projects only (link tables are append-oriented)
drop trigger if exists set_dream_projects_updated_at on public.dream_projects;
create trigger set_dream_projects_updated_at
before update on public.dream_projects
for each row execute function public.set_updated_at();

alter table public.dream_projects enable row level security;
alter table public.dream_session_projects enable row level security;
alter table public.dream_candidate_projects enable row level security;

grant all on public.dream_projects to service_role;
grant all on public.dream_session_projects to service_role;
grant all on public.dream_candidate_projects to service_role;

drop policy if exists "service role full access dream_projects" on public.dream_projects;
create policy "service role full access dream_projects"
  on public.dream_projects
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role full access dream_session_projects" on public.dream_session_projects;
create policy "service role full access dream_session_projects"
  on public.dream_session_projects
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role full access dream_candidate_projects" on public.dream_candidate_projects;
create policy "service role full access dream_candidate_projects"
  on public.dream_candidate_projects
  for all
  to service_role
  using (true)
  with check (true);
