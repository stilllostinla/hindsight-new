# hindsight-new — hosted-only

Supabase project: `wejlqffaatmkrswkbzyn` (hindsight-new, us-west-2)
URL: https://wejlqffaatmkrswkbzyn.supabase.co

## Models (OpenRouter)
- LLM: `meta/muse-spark-1.3-contributor`
- Decision: `typesafe/jev-router`
- Embeddings: `openai/text-embedding-3-small` dims 512 → `vector(512)`

## DB
- `hindsight.deployment_config` pinned
- `public.memories` + `search_memories(text, vector(512))` hybrid RRF
- extensions: vector, pg_trgm, uuid-ossp, pgcrypto

## Use
```bash
npm i @supabase/supabase-js
export SUPABASE_URL=https://wejlqffaatmkrswkbzyn.supabase.co
export SUPABASE_ANON_KEY=...
export OPENROUTER_API_KEY=...
```
See `supabase-client.ts` for retain/recall/reflect.
No Docker, no self-host.
