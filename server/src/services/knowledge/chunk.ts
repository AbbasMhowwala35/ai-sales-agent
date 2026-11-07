/** Split text into overlapping chunks along paragraph/sentence boundaries (~size chars). */
export function chunkText(text: string, size = 900, overlap = 150): string[] {
  const paras = text.split(/\n\s*\n|\n(?=[-•*\d]+[.)]?\s)/).map((p) => p.trim()).filter(Boolean);
  const units: string[] = [];
  for (const p of paras) {
    if (p.length <= size) { units.push(p); continue; }
    const sentences = p.match(/[^.!?\n]+[.!?]*\s*/g) ?? [p];
    let buf = '';
    for (const s of sentences) {
      if ((buf + s).length > size && buf) { units.push(buf.trim()); buf = ''; }
      if (s.length > size) { for (let i = 0; i < s.length; i += size) units.push(s.slice(i, i + size)); continue; }
      buf += s;
    }
    if (buf.trim()) units.push(buf.trim());
  }
  const chunks: string[] = [];
  let cur = '';
  for (const u of units) {
    if ((cur + '\n' + u).length > size && cur) {
      chunks.push(cur.trim());
      cur = cur.slice(Math.max(0, cur.length - overlap)).replace(/^\S*\s/, '') + '\n' + u;
    } else cur = cur ? cur + '\n' + u : u;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}
