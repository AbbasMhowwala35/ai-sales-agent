import PDFDocument from 'pdfkit';

/** Small report-layout toolkit on top of pdfkit: header band, KPI grid, tables with page breaks, bar rows. */
const C = { ink: '#16213A', muted: '#5C6880', line: '#E2E6ED', sunken: '#F2F4F8', signal: '#0B8F82', hot: '#D9822B', warm: '#C9A834', cold: '#6E8FB5', danger: '#C84040' };
export const COLORS = C;

export class Report {
  doc: PDFKit.PDFDocument;
  private x = 40;
  private w: number;
  constructor(public title: string, public subtitle: string, public business: string) {
    this.doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 50, left: 40, right: 40 }, bufferPages: true, info: { Title: title, Author: `${business} · Dialstack` } });
    this.w = this.doc.page.width - 80;
    this.header();
  }

  private header() {
    const d = this.doc;
    d.rect(0, 0, d.page.width, 92).fill(C.ink);
    d.save().translate(40, 28).lineWidth(2.2).strokeColor('#2BC3B2').moveTo(0, 14).lineTo(5, 14).lineTo(9, 4).lineTo(15, 26).lineTo(21, 9).lineTo(25, 15).lineTo(32, 15).stroke().restore();
    d.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18).text(this.title, 84, 26, { width: this.w - 44 });
    d.font('Helvetica').fontSize(10).fillColor('#B9C3D6').text(`${this.business} · ${this.subtitle}`, 84, 50, { width: this.w - 44 });
    d.fillColor(C.ink);
    d.y = 112;
  }

  ensure(h: number) { if (this.doc.y + h > this.doc.page.height - 60) { this.doc.addPage(); this.doc.y = 40; } }

  section(title: string, note?: string) {
    this.ensure(50);
    this.doc.moveDown(0.6).font('Helvetica-Bold').fontSize(13).fillColor(C.ink).text(title, this.x, this.doc.y);
    if (note) this.doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(note, this.x);
    this.doc.moveDown(0.4);
  }

  paragraph(text: string, opts: { color?: string; size?: number } = {}) {
    this.ensure(30);
    this.doc.font('Helvetica').fontSize(opts.size ?? 10).fillColor(opts.color ?? C.ink).text(text, this.x, this.doc.y, { width: this.w, lineGap: 2 });
    this.doc.moveDown(0.3);
  }

  kpis(items: { label: string; value: string | number; sub?: string; accent?: boolean }[], perRow = 4) {
    const gap = 8, cw = (this.w - gap * (perRow - 1)) / perRow, ch = 58;
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(ch + 8);
      const y = this.doc.y;
      items.slice(i, i + perRow).forEach((k, j) => {
        const x = this.x + j * (cw + gap);
        this.doc.roundedRect(x, y, cw, ch, 6).fillAndStroke('#FFFFFF', C.line);
        this.doc.fillColor(C.muted).font('Helvetica').fontSize(8.5).text(k.label, x + 10, y + 9, { width: cw - 20 });
        this.doc.fillColor(k.accent ? C.signal : C.ink).font('Helvetica-Bold').fontSize(17).text(String(k.value), x + 10, y + 21, { width: cw - 20 });
        if (k.sub) this.doc.fillColor(C.muted).font('Helvetica').fontSize(7.5).text(k.sub, x + 10, y + 42, { width: cw - 20 });
      });
      this.doc.y = y + ch + gap;
    }
  }

  /** Horizontal bars: label · bar · value. */
  bars(rows: { label: string; value: number; color?: string }[]) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    const lw = 120, vw = 40, bw = this.w - lw - vw - 10;
    for (const r of rows) {
      this.ensure(18);
      const y = this.doc.y;
      this.doc.fillColor(C.muted).font('Helvetica').fontSize(9).text(r.label, this.x, y + 2, { width: lw - 8 });
      this.doc.roundedRect(this.x + lw, y + 2, bw, 10, 3).fill(C.sunken);
      if (r.value > 0) this.doc.roundedRect(this.x + lw, y + 2, Math.max(3, (r.value / max) * bw), 10, 3).fill(r.color ?? C.signal);
      this.doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(9).text(String(r.value), this.x + lw + bw + 6, y + 2, { width: vw, align: 'right' });
      this.doc.y = y + 17;
    }
    this.doc.moveDown(0.3);
  }

  /** Column chart for a daily series. */
  columns(rows: { label: string; a: number; b?: number }[], legend: [string, string?]) {
    const h = 110; this.ensure(h + 34);
    const y0 = this.doc.y, max = Math.max(1, ...rows.map((r) => Math.max(r.a, r.b ?? 0)));
    const cw = this.w / Math.max(1, rows.length);
    this.doc.moveTo(this.x, y0 + h).lineTo(this.x + this.w, y0 + h).lineWidth(0.5).strokeColor(C.line).stroke();
    rows.forEach((r, i) => {
      const x = this.x + i * cw + cw * 0.15, bw = cw * 0.7;
      const ha = (r.a / max) * (h - 4);
      if (ha) this.doc.rect(x, y0 + h - ha, bw, ha).fill(C.cold);
      if (r.b) { const hb = (r.b / max) * (h - 4); this.doc.rect(x + bw * 0.25, y0 + h - hb, bw * 0.5, hb).fill(C.signal); }
      if (rows.length <= 16 || i % Math.ceil(rows.length / 10) === 0) this.doc.fillColor(C.muted).fontSize(6.5).font('Helvetica').text(r.label, x - 6, y0 + h + 3, { width: bw + 12, align: 'center' });
    });
    const ly = y0 + h + 16;
    this.doc.rect(this.x, ly + 1, 8, 8).fill(C.cold); this.doc.fillColor(C.muted).fontSize(8).text(legend[0], this.x + 12, ly);
    if (legend[1]) { this.doc.rect(this.x + 90, ly + 1, 8, 8).fill(C.signal); this.doc.fillColor(C.muted).text(legend[1], this.x + 102, ly); }
    this.doc.y = ly + 18;
  }

  table(cols: { key: string; label: string; width: number; align?: 'left' | 'right' | 'center'; color?: (row: any) => string | undefined }[], rows: any[], empty = 'No records.') {
    const total = cols.reduce((a, c) => a + c.width, 0);
    const scale = this.w / total;
    const ws = cols.map((c) => c.width * scale);
    const head = () => {
      this.ensure(24);
      const y = this.doc.y;
      this.doc.rect(this.x, y, this.w, 18).fill(C.sunken);
      let x = this.x;
      cols.forEach((c, i) => { this.doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8).text(c.label, x + 5, y + 5, { width: ws[i] - 10, align: c.align ?? 'left' }); x += ws[i]; });
      this.doc.y = y + 18;
    };
    head();
    if (!rows.length) { this.paragraph(empty, { color: C.muted, size: 9 }); return; }
    rows.forEach((r, ri) => {
      const heights = cols.map((c, i) => this.doc.font('Helvetica').fontSize(8.5).heightOfString(String(r[c.key] ?? '—'), { width: ws[i] - 10 }));
      const h = Math.max(16, ...heights) + 6;
      if (this.doc.y + h > this.doc.page.height - 60) { this.doc.addPage(); this.doc.y = 40; head(); }
      const y = this.doc.y;
      if (ri % 2) this.doc.rect(this.x, y, this.w, h).fill('#FAFBFC');
      let x = this.x;
      cols.forEach((c, i) => {
        this.doc.fillColor(c.color?.(r) ?? C.ink).font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).text(String(r[c.key] ?? '—'), x + 5, y + 4, { width: ws[i] - 10, align: c.align ?? 'left' });
        x += ws[i];
      });
      this.doc.moveTo(this.x, y + h).lineTo(this.x + this.w, y + h).lineWidth(0.4).strokeColor(C.line).stroke();
      this.doc.y = y + h;
    });
    this.doc.moveDown(0.5);
  }

  /** Finalise: page footers, then return the PDF bytes. */
  async toBuffer(): Promise<Buffer> {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      d.switchToPage(i);
      d.fillColor(C.muted).font('Helvetica').fontSize(7.5).text(`Generated ${new Date().toUTCString()} · Dialstack · Confidential`, 40, d.page.height - 32, { width: this.w / 2, lineBreak: false });
      d.text(`Page ${i + 1} of ${range.count}`, 40 + this.w / 2, d.page.height - 32, { width: this.w / 2, align: 'right', lineBreak: false });
    }
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      d.on('data', (c) => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks))); d.on('error', reject);
      d.end();
    });
  }
}

/** pdfkit's standard fonts are WinAnsi: replace characters they can't render. */
export const clean = (s: unknown) => String(s ?? '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, '-').replace(/…/g, '...').replace(/₹/g, 'Rs ').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
