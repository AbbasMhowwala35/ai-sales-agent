import { BusinessKnowledge, KnowledgeChunk } from '../../models/index.js';
import { getEmbeddings } from '../../providers/embeddings/index.js';
import { chunkText } from './chunk.js';
import { cleanText } from './extract.js';
import { sha256 } from '../../lib/crypto.js';

/** Chunk + embed + store a document's text. Replaces any previous chunks for that document. */
export async function indexDocument(businessId: unknown, documentId: unknown, rawText: string) {
  const doc = await BusinessKnowledge.findOne({ businessId, _id: documentId });
  if (!doc) return;
  const text = cleanText(rawText);
  if (text.length < 20) {
    doc.status = 'failed'; doc.error = 'No readable text found in this source';
    await doc.save();
    return doc;
  }
  doc.status = 'processing';
  await doc.save();
  const chunks = chunkText(text);
  const emb = getEmbeddings();
  const vectors = await emb.embed(chunks.map((c) => `${doc.title}\n${c}`));
  await KnowledgeChunk.deleteMany({ businessId, documentId });
  await KnowledgeChunk.insertMany(chunks.map((c, i) => ({ businessId, documentId, position: i, text: c, embedding: vectors[i], embeddingModel: emb.model, title: doc.title })));
  doc.set({ status: 'ready', error: undefined, charCount: text.length, chunkCount: chunks.length, contentHash: sha256(text), rawText: text.slice(0, 500_000) });
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
      `Company: ${b.name}`, b.industry && `Industry: ${b.industry}`, b.website && `Website: ${b.website}`, b.location && `Location: ${b.location}`,
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
