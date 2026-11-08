---
name: hindsight-memory
description: Hosted long-term agent memory on Supabase (hindsight-new) via retain/recall/reflect. Use when the user asks to remember, store, recall, search memory, reflect, set up Hindsight, or use long-term / persistent memory across sessions. Hosted-only — no Docker, no self-hosted Hindsight server.
---

# Hindsight Memory (Hosted)

Long-term memory that learns, on Supabase hosted API + OpenRouter. No self-host.

## Stack (pinned, do not change without migration)

| Layer | Value |
|---|---|
| Supabase project | `hindsight-new` — ref `wejlqffaatmkrswkbzyn`, us-west-2 |
| Supabase URL | `https://wejlqffaatmkrswkbzyn.supabase.co` |
| Table | `public.memories` — `embedding vector(512)`, HNSW index, `fts` tsvector |
| RPC | `public.search_memories(query_text text, query_embedding vector(512), match_count int, in_namespaces text[])` — vector + BM25 fused by RRF in SQL |
| Graph | `public.entities` + `public.memory_entities` (app tables, joins/recursive CTE) |
| LLM | `meta/muse-spark-1.3-contributor` via OpenRouter |
| Decision (jev) | `typesafe/jev-router` via OpenRouter |
| Embeddings | `openai/text-embedding-3-small` with `dimensions: 512` via OpenRouter |

Old project `supabase memory` (`bbgxpgqhiaaxyspvamsu`) has the same shape with 8 rows — do not write to it unless the user says so.

## Extensions

- **pgvector: YES, required.** Installed `vector 0.8.2`. Semantic arm + `vector(512)`.
- **Graph extension: NO.** Not needed and not available on Supabase hosted (no Apache AGE in `pg_available_extensions`; `pg_graphql` is GraphQL, not a graph DB).
- Hindsight graph arm = `entities` / `memory_entities` tables + `pg_trgm 1.6` for fuzzy entity names. 2-hop via a shared entity (e.g. `google`) joins two facts never stored together.
- Also on: `uuid-ossp`, `pgcrypto`. If a true Cypher/AGE graph is ever required, that means self-host — stop and ask.

## Secrets (never hardcode, never print)

Use by env name only in bash/tools:

- `$OPENROUTER` — OpenRouter key (LLM + decision + embeddings)
- `$SUPABASE_ACCESS_TOKEN` — Management API only (`api.supabase.com`), for DDL/admin, not app calls
- `$SUPABASE_NEW_DB_PASSWORD` — DB password for `hindsight-new`
- `$GITHUB_PAT` — backup repo push

App code uses `SUPABASE_URL`, `SUPABASE_ANON_KEY` (RLS-safe; `service_role` only server-side), `OPENROUTER_API_KEY`. Get anon key from Supabase Dashboard → API. Never paste keys in chat — request via Secrets if missing.

## Operations

### retain(bank, content) — store what happened

1. Embed with `openai/text-embedding-3-small`, `dimensions: 512`. Assert `len == 512` before insert or Postgres rejects it.
2. Insert into `public.memories (namespace, content, memory_type, tags, embedding)`.
3. Link entities: extract named things, upsert into `entities (namespace, name, normalized=lower(name))`, insert into `memory_entities`. Without this, graph recall has nothing to hop on.

### recall(bank, query) — search it back

1. Embed the query (same model/dims).
2. Call RPC `search_memories` — returns vector + keyword hits fused by rank.
3. Optional graph pass: find entities in hits, pull other memories sharing an entity (1–2 hops), merge in.

### reflect(bank, question) — reason over it

1. `recall` first. Never answer before retrieving something.
2. Decision gate: ask `typesafe/jev-router` — `YES` if evidence answers, else `NO`. If `NO`, say what is missing or recall again with a broader query.
3. Answer with `meta/muse-spark-1.3-contributor`, **only from evidence**, citing memory IDs like `[b7bb3905-...]`. Only cite IDs actually retrieved.

## Quick start (Python, tested 2026-11-08)

```python
import os, json, urllib.request
OR_KEY = os.environ['OPENROUTER']  # or OPENROUTER_API_KEY in app code
def or_post(path, body):
    req = urllib.request.Request('https://openrouter.ai/api/v1'+path,
        data=json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {OR_KEY}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())

def embed(text):
    j = or_post('/embeddings', {"model": "openai/text-embedding-3-small", "input": text, "dimensions": 512})
    emb = j['data'][0]['embedding']
    assert len(emb) == 512
    return emb

def llm(model, messages):
    j = or_post('/chat/completions', {"model": model, "messages": messages})
    return j['choices'][0]['message']['content']

# gate then answer (reflect)
gate = llm('typesafe/jev-router', [
  {"role": "system", "content": "Reply YES if evidence answers the question, else NO. One word."},
  {"role": "user", "content": f"Q: {question}\nEvidence:\n{evidence}"}])
answer = llm('meta/muse-spark-1.3-contributor', [
  {"role": "system", "content": "Answer only from evidence. Cite IDs like [id]. Keep short."},
  {"role": "user", "content": f"Q: {question}\nEvidence:\n{evidence}\nGate: {gate}"}])
```

TypeScript client (hosted PostgREST + RPC): `projects/hindsight-new/supabase-client.ts` in the backup repo — same three functions via `@supabase/supabase-js`.

Admin/DDL via Management API (token above):

```python
# POST https://api.supabase.com/v1/projects/wejlqffaatmkrswkbzyn/database/query
# headers: Authorization: Bearer $SUPABASE_ACCESS_TOKEN, Content-Type: application/json
# body: {"query": "<sql>"}
```

## Verified example (2026-11-08)

- Retain: `"User prefers Vue over React for frontend work, switched from React to Vue in 2025, and works at Google in Mountain View."` → `b7bb3905-f706-41b4-bcb8-8fa22e4e2d5b`
- Retain: `"Alice works at Google as a software engineer."` → `623068a1-421f-42d8-b9d2-e1b9b77dd477`
- Recall `"Where does Alice work and what frontend does the user prefer?"` → both hits
- Graph 2-hop via entity `google` → both contents
- Reflect gate `YES` → `Alice works at Google [623068a1...]. User prefers Vue over React [b7bb3905...].`

## Rules

1. Default bank/namespace is `'shared'` unless the user names another. One bank per user/agent/repo when isolation matters.
2. Always embed at 512 dims. Changing embedding model or dims = new `vector(N)` column + re-embed everything. Do not mix.
3. Retain facts, not transcripts: extract what was said into short, typed facts (`semantic`, `episodic`, preference, decision) before storing.
4. Do not write to the old `bbgxpgqhiaaxyspvamsu` project by default.
5. Do not start Docker / `HINDSIGHT_API_DATABASE_URL` self-host flow. Hosted-only unless the user explicitly changes that.
6. Backup repo: `stilllostinla/hindsight-new` (`supabase-setup.sql`, `supabase-client.ts`, this skill under `skills/`). Commit schema/client changes there; no secrets in repo.

## Troubleshooting

- `expected 512 dimensions, not N` — embedding call missing `"dimensions": 512`.
- No recall hits — check `namespace` matches, `status='active'`, embedding not null; try keyword-only query to separate vector vs BM25.
- Management API 400 on SQL — quoting/`%` formatting issue; send SQL via a Python file (write tool), not inline shell quoting.
- Upstream docs skill exists (`npx skills add https://github.com/vectorize-io/hindsight --skill hindsight-docs`) but describes the self-hosted server — do not follow its Docker/env setup here.
