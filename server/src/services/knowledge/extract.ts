import mammoth from 'mammoth';
import * as cheerio from 'cheerio';
import { badRequest } from '../../lib/errors.js';

export const SUPPORTED_TYPES: Record<string, 'pdf' | 'docx' | 'txt' | 'md' | 'csv'> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
};

export function detectType(filename: string, mime?: string) {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const byExt: Record<string, 'pdf' | 'docx' | 'txt' | 'md' | 'csv'> = { pdf: 'pdf', docx: 'docx', txt: 'txt', md: 'md', markdown: 'md', csv: 'csv' };
  return byExt[ext] ?? (mime ? SUPPORTED_TYPES[mime] : undefined);
}

export async function extractText(buf: Buffer, type: string): Promise<string> {
  switch (type) {
    case 'pdf': {
      if (buf.subarray(0, 5).toString() !== '%PDF-') throw badRequest('File is not a valid PDF');
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try { return (await parser.getText()).text; } finally { await parser.destroy(); }
    }
    case 'docx': {
      const r = await mammoth.extractRawText({ buffer: buf });
      return r.value;
    }
    case 'txt': case 'md': case 'csv':
      return buf.toString('utf8');
    default:
      throw badRequest(`Unsupported file type: ${type}`);
  }
}

export function htmlToText(html: string) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg,iframe,nav,footer,header form').remove();
  const title = $('title').first().text().trim();
  const desc = $('meta[name="description"]').attr('content') ?? '';
  const parts: string[] = [];
  $('h1,h2,h3,h4,p,li,td,th,blockquote,dt,dd').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t.length > 2) parts.push(t);
  });
  const text = [title, desc, ...parts].filter(Boolean).join('\n');
  const links = $('a[href]').map((_, a) => $(a).attr('href')).get();
  return { title, text: [...new Set(text.split('\n'))].join('\n'), links };
}

export function cleanText(t: string) {
  return t.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
