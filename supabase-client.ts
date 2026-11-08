// Hosted-only client for hindsight-new
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)
const OR_BASE = 'https://openrouter.ai/api/v1'
const OR_KEY = process.env.OPENROUTER_API_KEY!
async function embed(text: string) {
  const r = await fetch(`${OR_BASE}/embeddings`, {
    method: 'POST', headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: text, dimensions: 512 }),
  })
  return (await r.json()).data[0].embedding
}
async function llm(messages: any[], model = 'meta/muse-spark-1.3-contributor') {
  const r = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages }),
  })
  return (await r.json()).choices[0].message.content
}
export async function retain(bank: string, content: string, tags: string[] = []) {
  const embedding = await embed(content)
  const { data, error } = await supabase.from('memories')
    .insert({ namespace: bank, content, tags, embedding }).select('id').single()
  if (error) throw error
  return data.id
}
export async function recall(bank: string, query: string, match_count = 8) {
  const query_embedding = await embed(query)
  const { data, error } = await supabase.rpc('search_memories', { query_text: query, query_embedding, match_count, in_namespaces: [bank] })
  if (error) throw error
  return data
}
export async function reflect(bank: string, question: string) {
  const hits: any[] = await recall(bank, question)
  const evidence = hits.map((h: any) => `- [${h.id}] ${h.content}`).join('\n')
  const gate = await llm([{ role: 'system', content: 'You are typesafe/jev-router. Reply YES if evidence answers, else NO.' }, { role: 'user', content: `Q:${question}\n${evidence}` }], 'typesafe/jev-router')
  const answer = await llm([{ role: 'system', content: 'Answer only from evidence with cites.' }, { role: 'user', content: `Q:${question}\n${evidence}\nGate:${gate}` }])
  return { answer, hits, gate }
}
