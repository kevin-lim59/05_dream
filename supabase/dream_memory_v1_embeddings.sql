-- dream_memory_v1_embeddings.sql
-- Selective embedding persistence for dream-memory v1.
-- Intended to layer on top of:
--   1) supabase/dream_memory.sql
--   2) supabase/dream_memory_v1_projects.sql (optional but recommended)

create table if not exists public.dream_embedding_documents (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_key text not null,
  external_session_id text,
  project_slug text,
  provider text not null default 'local',
  model text not null default 'stub-v1',
  content_text text not null,
  content_hash text not null,
  payload_fingerprint text not null,
  source_ref_json jsonb not null default '{}'::jsonb,
  selection_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  status text not null default 'prepared',
  request_count integer not null default 1,
  last_requested_at timestamptz not null default now(),
  last_built_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_type, source_key),
  constraint dream_embedding_documents_source_type_check check (source_type in ('candidate', 'promotion')),
  constraint dream_embedding_documents_status_check check (status in ('prepared', 'queued', 'embedded', 'failed', 'skipped')),
  constraint dream_embedding_documents_request_count_check check (request_count >= 1)
);

create index if not exists dream_embedding_documents_session_idx
  on public.dream_embedding_documents(external_session_id);
create index if not exists dream_embedding_documents_project_idx
  on public.dream_embedding_documents(project_slug);
create index if not exists dream_embedding_documents_status_idx
  on public.dream_embedding_documents(status);
create index if not exists dream_embedding_documents_hash_idx
  on public.dream_embedding_documents(content_hash);
create index if not exists dream_embedding_documents_payload_fingerprint_idx
  on public.dream_embedding_documents(payload_fingerprint);

create table if not exists public.dream_embeddings (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.dream_embedding_documents(id) on delete set null,
  source_type text not null,
  source_key text not null,
  provider text not null default 'local',
  model text not null default 'stub-v1',
  content_hash text not null,
  payload_fingerprint text not null,
  dimensions integer,
  vector_json jsonb,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  generated_at timestamptz,
  last_error text,
  audit_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_type, source_key, provider, model),
  constraint dream_embeddings_source_type_check check (source_type in ('candidate', 'promotion')),
  constraint dream_embeddings_status_check check (status in ('pending', 'embedded', 'failed', 'skipped')),
  constraint dream_embeddings_dimensions_check check (dimensions is null or dimensions > 0)
);

create index if not exists dream_embeddings_document_idx
  on public.dream_embeddings(document_id);
create index if not exists dream_embeddings_lookup_idx
  on public.dream_embeddings(source_type, source_key, provider, model);
create index if not exists dream_embeddings_status_idx
  on public.dream_embeddings(status);
create index if not exists dream_embeddings_hash_idx
  on public.dream_embeddings(content_hash);
create index if not exists dream_embeddings_payload_fingerprint_idx
  on public.dream_embeddings(payload_fingerprint);

-- Optional pgvector hook can be added later without changing the document/source-key contract.
-- Example future migration:
--   alter table public.dream_embeddings add column vector_embedding vector(1536);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_dream_embedding_documents_updated_at on public.dream_embedding_documents;
create trigger set_dream_embedding_documents_updated_at
before update on public.dream_embedding_documents
for each row execute function public.set_updated_at();

drop trigger if exists set_dream_embeddings_updated_at on public.dream_embeddings;
create trigger set_dream_embeddings_updated_at
before update on public.dream_embeddings
for each row execute function public.set_updated_at();

alter table public.dream_embedding_documents enable row level security;
alter table public.dream_embeddings enable row level security;

grant all on public.dream_embedding_documents to service_role;
grant all on public.dream_embeddings to service_role;

drop policy if exists "service role full access dream_embedding_documents" on public.dream_embedding_documents;
create policy "service role full access dream_embedding_documents"
  on public.dream_embedding_documents
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role full access dream_embeddings" on public.dream_embeddings;
create policy "service role full access dream_embeddings"
  on public.dream_embeddings
  for all
  to service_role
  using (true)
  with check (true);
