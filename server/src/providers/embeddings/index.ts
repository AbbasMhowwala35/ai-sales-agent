import { env } from '../../config/env.js';
import { fetchWithRetry, jsonOrThrow, isAccountError } from '../http.js';
import { logger } from '../../lib/logger.js';

export interface EmbeddingProvider { model: string; dims: number; embed(texts: string[]): Promise<number[][]> }

export class OpenAIEmbeddings implements EmbeddingProvider {
  dims = 1536;
  constructor(private apiKey: string, public model = env.OPENAI_EMBEDDING_MODEL) {}
  async embed(texts: string[]) {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 96) {
      const res = await fetchWithRetry(`${env.OPENAI_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, input: texts.slice(i, i + 96) }),
      });
      const data = await jsonOrThrow(res, 'OpenAI embeddings');
      out.push(...data.data.map((d: any) => d.embedding));
    }
    return out;
  }
}

const STOP = new Set('a an and are as at be by for from has have he her his i in is it its of on or our that the their them they this to was we were will with you your can do does what how which who when where why not no yes so if but about into than then there these those also just more most such only own same very s t'.split(' '));

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9ऀ-ॿ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

function stem(w: string) {
  return w.replace(/(ingly|edly|ing|ed|ies|es|s|ly)$/,(m)=> (m === 'ies' ? 'y' : '')).slice(0, 24) || w;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Offline embedding: signed feature hashing of unigrams + bigrams + char trigrams, sub-linear TF, L2-normalised.
 * Not as semantic as a neural model, but gives real lexical retrieval with zero external dependencies.
 */
export class LocalHashEmbeddings implements EmbeddingProvider {
  model = 'local-hash-v1';
  dims = 768;
  async embed(texts: string[]) {
    return texts.map((t) => this.vector(t));
  }
  vector(text: string) {
    const v = new Float64Array(this.dims);
    const toks = tokenize(text);
    const add = (f: string, w: number) => { const h = hash(f); v[h % this.dims] += (h & 0x80000000 ? -1 : 1) * w; };
    const tf = new Map<string, number>();
    toks.forEach((t, i) => {
      tf.set(t, (tf.get(t) ?? 0) + 1);
      if (i > 0) tf.set(`${toks[i - 1]}_${t}`, (tf.get(`${toks[i - 1]}_${t}`) ?? 0) + 0.7);
      if (t.length > 4) for (let j = 0; j <= t.length - 3; j++) tf.set(`#${t.slice(j, j + 3)}`, (tf.get(`#${t.slice(j, j + 3)}`) ?? 0) + 0.15);
    });
    for (const [f, c] of tf) add(f, 1 + Math.log(c));
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
    return Array.from(v, (x) => +(x / n).toFixed(5));
  }
}

/** OpenAI embeddings that switch to the built-in embedder for good if the account has no credits or the key is wrong. */
export class FallbackEmbeddings implements EmbeddingProvider {
  private local = new LocalHashEmbeddings();
  private degraded = false;
  constructor(private primary: EmbeddingProvider) {}
  get model() { return this.degraded ? this.local.model : this.primary.model; }
  get dims() { return this.degraded ? this.local.dims : this.primary.dims; }
  async embed(texts: string[]) {
    if (this.degraded) return this.local.embed(texts);
    try { return await this.primary.embed(texts); } catch (e) {
      if (!isAccountError(e)) throw e;
      this.degraded = true;
      logger.warn('OpenAI embeddings unavailable (no credits or invalid key) — using built-in embeddings instead');
      return this.local.embed(texts);
    }
  }
}

let cached: EmbeddingProvider | undefined;
export function getEmbeddings(): EmbeddingProvider {
  if (cached) return cached;
  cached = env.EMBEDDING_PROVIDER === 'openai' && env.OPENAI_API_KEY ? new FallbackEmbeddings(new OpenAIEmbeddings(env.OPENAI_API_KEY)) : new LocalHashEmbeddings();
  return cached;
}

export function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
