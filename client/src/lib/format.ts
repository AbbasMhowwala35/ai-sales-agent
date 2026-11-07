export const fmtDate = (d?: string | Date | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d?: string | Date | null) => d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
export const fmtDuration = (s?: number) => { if (!s) return '0:00'; const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`; };
export const fmtNum = (n?: number) => (n ?? 0).toLocaleString('en-IN');
export const timeAgo = (d?: string | Date) => {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(d);
};
export const STAGE_LABELS: Record<string, string> = { new: 'New', qualified: 'Qualified', contacted: 'Contacted', interested: 'Interested', meeting_scheduled: 'Meeting scheduled', converted: 'Converted', lost: 'Lost' };
export const STAGES = Object.keys(STAGE_LABELS);
export const initials = (n?: string) => (n ?? '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
export const cap = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : '');
export const sourceLabel = (s: string) => ({ google_places: 'Google Places', apollo: 'Apollo.io', sandbox: 'Sandbox', csv_import: 'CSV import', manual: 'Manual' } as Record<string, string>)[s] ?? cap(s);
