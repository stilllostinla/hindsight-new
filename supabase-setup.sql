-- hindsight-new hosted setup (applied 2026-11-08)
create extension if not exists vector;   -- pgvector 0.8.2, REQUIRED
create extension if not exists pg_trgm;  -- entity fuzzy linking
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;
-- NOTE: No graph extension needed / none available on Supabase hosted.
-- No Apache AGE in pg_available_extensions. pg_graphql != graph DB.
-- Hindsight graph arm = app tables + joins / recursive CTE (below).

create schema if not exists hindsight;
create table if not exists hindsight.deployment_config (
  id uuid primary key default uuid_generate_v4(),
  llm_provider text, llm_model text,
  decision_provider text, decision_model text,
  embeddings_provider text, embeddings_model text, embeddings_dims int,
  created_at timestamptz default now());
-- pinned: openrouter/meta/muse-spark-1.3-contributor,
-- openrouter/typesafe/jev-router,
-- openrouter/openai/text-embedding-3-small dims 512

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  namespace text not null default 'shared',
  content text not null,
  memory_type text default 'semantic',
  tags text[] default '{}',
  embedding vector(512),
  status text default 'active',
  meta jsonb default '{}'::jsonb,
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz default now());
create index if not exists memories_embedding_hnsw on public.memories using hnsw (embedding vector_cosine_ops);
create index if not exists memories_fts_gin on public.memories using gin (fts);
-- RPC public.search_memories(...) : vector + BM25 RRF fusion (see repo history)

-- Graph arm (no extension)
create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  namespace text not null default 'shared',
  name text not null, normalized text not null,
  created_at timestamptz default now(),
  unique(namespace, normalized));
create table if not exists public.memory_entities (
  memory_id uuid references public.memories(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete cascade,
  primary key (memory_id, entity_id));
create index if not exists entities_norm_trgm on public.entities using gin (normalized gin_trgm_ops);
