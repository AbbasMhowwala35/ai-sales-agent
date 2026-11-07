import { Types } from 'mongoose';
import { KnowledgeChunk } from '../../models/index.js';
import { getEmbeddings, cosine, tokenize } from '../../providers/embeddings/index.js';
import { getLLM } from '../../providers/llm/index.js';

export interface RetrievedChunk { id: string; documentId: string; title: string; text: string; score: number }

/**
 * Hybrid retrieval scoped to one business: vector cosine similarity + lexical overlap boost.
 * Candidates are filtered by businessId in the DB query — chunks of other tenants are never loaded.
 * For very large KBs swap the scan for MongoDB Atlas $vectorSearch (same interface).
 */
export async function retrieve(businessId: unknown, query: string, k = 4, minScore = 0.08): Promise<RetrievedChunk[]> {
  if (!query?.trim()) return [];
  const emb = getEmbeddings();
  const [qv] = await emb.embed([query]);
  const qTokens = new Set(tokenize(query));
  const cursor = KnowledgeChunk.find({ businessId: new Types.ObjectId(String(businessId)), embeddingModel: emb.model }, { text: 1, embedding: 1, documentId: 1, title: 1 }).lean().cursor({ batchSize: 500 });
  const top: RetrievedChunk[] = [];
  for await (const c of cursor as any) {
    const vec = cosine(qv, c.embedding);
    const toks = tokenize(c.text);
    const overlap = qTokens.size ? toks.filter((t) => qTokens.has(t)).length / (qTokens.size + Math.sqrt(toks.length)) : 0;
    const score = 0.75 * vec + 0.25 * Math.min(1, overlap * 2);
    if (score < minScore) continue;
    top.push({ id: String(c._id), documentId: String(c.documentId), title: c.title, text: c.text, score: +score.toFixed(4) });
    top.sort((a, b) => b.score - a.score);
    if (top.length > k) top.pop();
  }
  return top;
}

/** Pick the sentences of the retrieved chunks that best match the question (offline answer mode). */
export function extractiveAnswer(query: string, chunks: RetrievedChunk[], maxSentences = 3) {
  const q = new Set(tokenize(query));
  const sentences: { s: string; score: number; order: number }[] = [];
  chunks.forEach((c, ci) => {
    // Prefer FAQ answers when the question matches a Q:
    const qa = [...c.text.matchAll(/Q:\s*(.+?)\nA:\s*([\s\S]+?)(?=\n\s*Q:|$)/g)];
    for (const m of qa) {
      const qs = tokenize(m[1]);
      const ov = qs.filter((t) => q.has(t)).length / Math.max(1, q.size);
      if (ov >= 0.5) sentences.push({ s: m[2].trim(), score: 2 + ov - ci * 0.01, order: ci });
    }
    for (const s of c.text.replace(/\n/g, '. ').split(/(?<=[.!?])\s+/)) {
      const st = s.trim();
      if (st.length < 15 || /^Q:/.test(st)) continue;
      const toks = tokenize(st);
      const ov = toks.filter((t) => q.has(t)).length;
      if (ov) sentences.push({ s: st.replace(/^A:\s*/, ''), score: ov / Math.sqrt(toks.length + 1) + c.score - ci * 0.05, order: ci });
    }
  });
  sentences.sort((a, b) => b.score - a.score);
  const picked: string[] = [];
  for (const x of sentences) {
    if (picked.length >= maxSentences) break;
    if (!picked.some((p) => p.includes(x.s) || x.s.includes(p))) picked.push(x.s);
    if (x.score >= 2) break; // a matched FAQ answer is enough on its own
  }
  return picked.join(' ').replace(/\.\./g, '.');
}

export async function answerQuestion(businessId: unknown, question: string, businessName = 'the company') {
  const chunks = await retrieve(businessId, question, 4);
  if (!chunks.length) return { answer: "I don't have that information in the knowledge base yet.", sources: [], grounded: false };
  const llm = getLLM();
  let answer: string;
  if (llm) {
    const context = chunks.map((c, i) => `[${i + 1}] (${c.title}) ${c.text}`).join('\n\n');
    const r = await llm.chat([
      { role: 'system', content: `You answer questions about ${businessName} using ONLY the context. If the context doesn't contain the answer, say you don't know. Be concise (max 3 sentences). Cite sources like [1].` },
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
    ], { temperature: 0.1, maxTokens: 300 });
    answer = r.content.trim();
  } else {
    answer = extractiveAnswer(question, chunks) || "I don't have that information in the knowledge base yet.";
  }
  return { answer, sources: chunks.map((c) => ({ documentId: c.documentId, title: c.title, score: c.score, excerpt: c.text.slice(0, 280) })), grounded: true };
}
