import { env } from '../../config/env.js';
import { BusinessKnowledge, KnowledgeChunk } from '../../models/index.js';
import { getEmbeddings } from '../../providers/embeddings/index.js';
import { chunkText } from './chunk.js';
import { cleanText } from './extract.js';
import { sha256 } from '../../lib/crypto.js';

/** Chunk + embed + store a document's text. Replaces any previous chunks for that document. */
export async function indexDocument(businessId: unknown, documentId: unknown, rawText: string) {
  const doc = await BusinessKnowledge.findOne({ businessId, _id: documentId });
  if (!doc) return;
  const full = cleanText(rawText);
  // Bounded memory: very large documents are indexed up to MAX_DOC_CHARS (the agent rarely needs more than this).
  const text = full.length > env.MAX_DOC_CHARS ? full.slice(0, env.MAX_DOC_CHARS) : full;
  if (text.length < 20) {
    doc.status = 'failed'; doc.error = 'No readable text found in this source';
    await doc.save();
    return doc;
  }
  doc.status = 'processing';
  await doc.save();
  const chunks = chunkText(text);
  const emb = getEmbeddings();
  await KnowledgeChunk.deleteMany({ businessId, documentId });
  // Embed + insert in small batches so a big document never holds thousands of vectors in memory at once.
  for (let i = 0; i < chunks.length; i += 40) {
    const part = chunks.slice(i, i + 40);
    const vectors = await emb.embed(part.map((c) => `${doc.title}\n${c}`));
    await KnowledgeChunk.insertMany(part.map((c, j) => ({ businessId, documentId, position: i + j, text: c, embedding: vectors[j], embeddingModel: emb.model, title: doc.title })));
  }
  doc.set({ status: 'ready', error: full.length > text.length ? `Large document: the first ${Math.round(text.length / 1000)}k characters were indexed` : undefined, charCount: text.length, chunkCount: chunks.length, contentHash: sha256(text), rawText: text.slice(0, 500_000) });
  await doc.save();
  return doc;
}

/** Mirror business settings (profile, products, FAQs, scripts) into the knowledge base so the agent can retrieve them. */
export async function syncBusinessProfileKnowledge(b: any) {
  const businessId = b._id;
  const sections: { title: string; type: 'profile' | 'faq' | 'script'; text: string }[] = [];
  const list = (arr: any[] = []) => arr.map((p) => `- ${p.name}${p.price ? ` (${p.price})` : ''}: ${p.description ?? ''}`).join('\n');
  sections.push({
    title: 'Business profile', type: 'profile',
    text: [
      b.name ? `Company: ${b.name}` : `Freelancer: ${b.ownerName ?? ''}`, b.industry && `Industry: ${b.industry}`, b.website && `Website: ${b.website}`, b.location && `Location: ${b.location}`,
      b.description && `About us: ${b.description}`,
      b.products?.length && `Products:\n${list(b.products)}`, b.services?.length && `Services:\n${list(b.services)}`,
      b.targetAudience && `Who we serve: ${b.targetAudience}`, b.goals && `Goals: ${b.goals}`,
      b.targetLocations?.length && `Service areas: ${b.targetLocations.join(', ')}`,
    ].filter(Boolean).join('\n\n'),
  });
  if (b.faqs?.length) sections.push({ title: 'Frequently asked questions', type: 'faq', text: b.faqs.map((f: any) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n') });
  if (b.salesScripts?.length) sections.push({ title: 'Sales scripts', type: 'script', text: b.salesScripts.map((s: any) => `${s.name}\n${s.content}`).join('\n\n') });

  for (const s of sections) {
    const hash = sha256(s.text);
    let doc = await BusinessKnowledge.findOne({ businessId, system: true, type: s.type });
    if (doc && doc.contentHash === hash && doc.status === 'ready') continue;
    if (!doc) doc = await BusinessKnowledge.create({ businessId, system: true, type: s.type, title: s.title, source: 'Business settings' });
    await indexDocument(businessId, doc._id, s.text);
  }
  // remove system docs whose section is now empty
  const kept = sections.map((s) => s.type);
  const stale = await BusinessKnowledge.find({ businessId, system: true, type: { $nin: kept } }, { _id: 1 }).lean();
  if (stale.length) {
    await KnowledgeChunk.deleteMany({ businessId, documentId: { $in: stale.map((d) => d._id) } });
    await BusinessKnowledge.deleteMany({ businessId, _id: { $in: stale.map((d) => d._id) } });
  }
}
