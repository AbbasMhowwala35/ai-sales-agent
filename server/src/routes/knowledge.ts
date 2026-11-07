import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { BusinessKnowledge, KnowledgeChunk, Business } from '../models/index.js';
import { scope } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { parse } from '../lib/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { env } from '../config/env.js';
import { detectType, extractText } from '../services/knowledge/extract.js';
import { enqueue } from '../queue/queue.js';
import { storage } from '../providers/storage/index.js';
import { answerQuestion, retrieve } from '../services/knowledge/retrieve.js';
import { audit } from '../services/audit.js';
import { getEmbeddings } from '../providers/embeddings/index.js';
import { getLLM } from '../providers/llm/index.js';

export const knowledgeRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 10 } });

knowledgeRouter.get('/', async (req, res) => {
  const docs = await BusinessKnowledge.find(scope(req)).sort({ system: -1, createdAt: -1 }).lean();
  const totals = docs.reduce((a, d) => ({ chunks: a.chunks + (d.chunkCount ?? 0), chars: a.chars + (d.charCount ?? 0) }), { chunks: 0, chars: 0 });
  res.json({ documents: docs, totals, engine: { embeddings: getEmbeddings().model, llm: getLLM()?.name ?? 'local-extractive' } });
});

knowledgeRouter.get('/:id', async (req, res) => {
  const doc = await BusinessKnowledge.findOne({ ...scope(req), _id: req.params.id }).select('+rawText').lean();
  if (!doc) throw notFound('Document');
  const chunks = await KnowledgeChunk.find({ ...scope(req), documentId: doc._id }, { text: 1, position: 1 }).sort({ position: 1 }).limit(200).lean();
  res.json({ ...doc, chunks });
});

knowledgeRouter.post('/upload', requirePermission('knowledge:write'), upload.array('files', 10), async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw badRequest('Attach at least one file (PDF, DOCX, TXT, MD or CSV)');
  const created: any[] = [];
  for (const f of files) {
    const type = detectType(f.originalname, f.mimetype);
    if (!type) throw badRequest(`Unsupported file type: ${f.originalname}. Use PDF, DOCX, TXT, MD or CSV.`);
    const doc = await BusinessKnowledge.create({ ...scope(req), title: f.originalname.replace(/\.[^.]+$/, ''), type, source: f.originalname, status: 'pending', uploadedBy: req.auth!.userId });
    const key = `${req.tenant!.businessId}/documents/${doc._id}-${f.originalname.replace(/[^\w.-]/g, '_')}`;
    await storage.put(key, f.buffer);
    doc.storageKey = key;
    await doc.save();
    await enqueue('knowledge.process', { documentId: String(doc._id) }, { businessId: req.tenant!.businessId });
    created.push(doc);
  }
  await audit(req, 'knowledge.uploaded', 'BusinessKnowledge', undefined, { files: files.map((f) => f.originalname) });
  res.status(202).json({ documents: created });
});

knowledgeRouter.post('/website', requirePermission('knowledge:write'), async (req, res) => {
  const { url, maxPages } = parse(z.object({ url: z.string().trim().min(4).max(500), maxPages: z.number().int().min(1).max(50).default(10) }), req.body);
  const doc = await BusinessKnowledge.create({ ...scope(req), title: `Website: ${url.replace(/^https?:\/\//, '')}`, type: 'website', source: url, status: 'pending', uploadedBy: req.auth!.userId });
  await enqueue('knowledge.website', { documentId: String(doc._id), url, maxPages }, { businessId: req.tenant!.businessId });
  res.status(202).json(doc);
});

knowledgeRouter.post('/text', requirePermission('knowledge:write'), async (req, res) => {
  const body = parse(z.object({ title: z.string().trim().min(1).max(200), content: z.string().trim().min(20).max(200_000) }), req.body);
  const doc = await BusinessKnowledge.create({ ...scope(req), title: body.title, type: 'manual', source: 'Manual entry', status: 'pending', uploadedBy: req.auth!.userId });
  await enqueue('knowledge.process', { documentId: String(doc._id), text: body.content }, { businessId: req.tenant!.businessId });
  res.status(202).json(doc);
});

knowledgeRouter.post('/:id/reindex', requirePermission('knowledge:write'), async (req, res) => {
  const doc = await BusinessKnowledge.findOne({ ...scope(req), _id: req.params.id });
  if (!doc) throw notFound('Document');
  if (doc.system) {
    const b = await Business.findById(req.tenant!.businessId);
    const { syncBusinessProfileKnowledge } = await import('../services/knowledge/ingest.js');
    doc.contentHash = undefined; await doc.save();
    await syncBusinessProfileKnowledge(b);
  } else if (doc.type === 'website') {
    await enqueue('knowledge.website', { documentId: String(doc._id), url: doc.source, maxPages: 10 }, { businessId: req.tenant!.businessId });
  } else {
    await enqueue('knowledge.process', { documentId: String(doc._id) }, { businessId: req.tenant!.businessId });
  }
  doc.status = 'pending'; await doc.save();
  res.status(202).json(doc);
});

knowledgeRouter.delete('/:id', requirePermission('knowledge:write'), async (req, res) => {
  const doc = await BusinessKnowledge.findOne({ ...scope(req), _id: req.params.id });
  if (!doc) throw notFound('Document');
  if (doc.system) throw badRequest('This document is generated from Business Settings — edit it there instead');
  await KnowledgeChunk.deleteMany({ ...scope(req), documentId: doc._id });
  if (doc.storageKey) await storage.remove(doc.storageKey);
  await BusinessKnowledge.deleteOne({ ...scope(req), _id: doc._id });
  await audit(req, 'knowledge.deleted', 'BusinessKnowledge', doc._id, { title: doc.title });
  res.status(204).end();
});

knowledgeRouter.post('/query', async (req, res) => {
  const { question } = parse(z.object({ question: z.string().trim().min(2).max(1000) }), req.body);
  const b = await Business.findById(req.tenant!.businessId, { name: 1 }).lean();
  res.json(await answerQuestion(req.tenant!.businessId, question, b?.name));
});

knowledgeRouter.post('/search', async (req, res) => {
  const { query, k } = parse(z.object({ query: z.string().trim().min(2).max(1000), k: z.number().int().min(1).max(20).default(5) }), req.body);
  res.json({ results: await retrieve(req.tenant!.businessId, query, k) });
});

/** Worker handlers */
export async function processDocumentJob(p: { documentId: string; text?: string }, job: { businessId?: string }) {
  const doc = await BusinessKnowledge.findOne({ businessId: job.businessId, _id: p.documentId });
  if (!doc) return;
  const { indexDocument } = await import('../services/knowledge/ingest.js');
  try {
    let text = p.text;
    if (!text) {
      if (!doc.storageKey) throw new Error('Original file missing');
      const chunks: Buffer[] = [];
      for await (const c of storage.stream(doc.storageKey)) chunks.push(c as Buffer);
      text = await extractText(Buffer.concat(chunks), doc.type);
    }
    await indexDocument(job.businessId, doc._id, text);
  } catch (e: any) {
    await BusinessKnowledge.updateOne({ businessId: job.businessId, _id: doc._id }, { status: 'failed', error: e.message?.slice(0, 500) });
  }
}

export async function websiteJob(p: { documentId: string; url: string; maxPages: number }, job: { businessId?: string }) {
  const { crawlWebsite } = await import('../services/knowledge/website.js');
  const { indexDocument } = await import('../services/knowledge/ingest.js');
  try {
    await BusinessKnowledge.updateOne({ businessId: job.businessId, _id: p.documentId }, { status: 'processing' });
    const pages = await crawlWebsite(p.url, p.maxPages);
    const text = pages.map((pg) => `## ${pg.title || pg.url}\nSource: ${pg.url}\n${pg.text}`).join('\n\n');
    await indexDocument(job.businessId, p.documentId, text);
  } catch (e: any) {
    await BusinessKnowledge.updateOne({ businessId: job.businessId, _id: p.documentId }, { status: 'failed', error: e.message?.slice(0, 500) });
  }
}
