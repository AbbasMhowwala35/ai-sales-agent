import { CalendarCheck, Sparkles, PhoneCall, Clock3, PhoneOff, PhoneMissed, XCircle, Ban, Circle, FileDown } from 'lucide-react';
import { useState } from 'react';
import { download } from '../lib/api';
import { toast } from '../store/ui';
import { Spinner, cx } from './ui';

export const OUTCOMES = {
  meeting: { label: 'Meeting booked', short: 'Meeting', icon: CalendarCheck, tone: 'text-signal-ink bg-signal-soft', dot: 'bg-signal', help: 'Booked a call with your specialist' },
  callback: { label: 'Call back', short: 'Callback', icon: PhoneCall, tone: 'text-hot bg-hot/12', dot: 'bg-hot', help: 'Asked to be called at a specific time — the agent calls back automatically' },
  interested: { label: 'Interested', short: 'Interested', icon: Sparkles, tone: 'text-signal-ink bg-signal-soft/70', dot: 'bg-signal/70', help: 'Liked it but didn’t book — a rep should follow up' },
  nurture: { label: 'Follow up later', short: 'Later', icon: Clock3, tone: 'text-cold bg-cold/12', dot: 'bg-cold', help: '“Not now” — the agent calls again on the date they gave' },
  busy: { label: 'Busy line', short: 'Busy', icon: PhoneOff, tone: 'text-[#7a6210] dark:text-warm bg-warm/20', dot: 'bg-warm', help: 'Line was busy — retrying' },
  no_answer: { label: 'No answer', short: 'No answer', icon: PhoneMissed, tone: 'text-muted bg-sunken', dot: 'bg-muted/60', help: 'Didn’t pick up — retrying' },
  not_interested: { label: 'Not interested', short: 'Not interested', icon: XCircle, tone: 'text-muted bg-sunken', dot: 'bg-muted', help: 'Said no — closed, won’t be called again' },
  do_not_call: { label: 'Do not call', short: 'Do not call', icon: Ban, tone: 'text-danger bg-danger/10', dot: 'bg-danger', help: 'Opted out — never called again' },
  none: { label: 'Not contacted', short: 'New', icon: Circle, tone: 'text-muted bg-sunken', dot: 'bg-line', help: 'No conversation yet' },
} as const;
export type OutcomeKey = keyof typeof OUTCOMES;
export const OUTCOME_ORDER: OutcomeKey[] = ['meeting', 'callback', 'interested', 'nurture', 'busy', 'no_answer', 'not_interested', 'do_not_call', 'none'];

export function OutcomeBadge({ o, size = 'sm' }: { o?: string; size?: 'sm' | 'md' }) {
  const d = OUTCOMES[(o ?? 'none') as OutcomeKey] ?? OUTCOMES.none;
  const Icon = d.icon;
  return <span title={d.help} className={cx('inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap', d.tone, size === 'md' ? 'px-3 py-1 text-[13px]' : 'px-2 py-0.5 text-xs')}><Icon className={size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />{d.label}</span>;
}

/** Follow-up time shown in the prospect’s own local time (they’re abroad; the user is not). */
export function localTime(d?: string | Date | null, tz?: string) {
  if (!d) return '';
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
  try { return new Date(d).toLocaleString('en-US', { ...opts, timeZone: tz }) + (tz ? ` ${tzAbbr(tz, d)}` : ''); } catch { return new Date(d).toLocaleString('en-US', opts); }
}
function tzAbbr(tz: string, d: string | Date) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(d)).find((p) => p.type === 'timeZoneName')?.value ?? ''; } catch { return ''; }
}

export function PdfButton({ path, filename, label = 'Download PDF', className }: { path: string; filename: string; label?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className={className ?? 'btn-secondary'} disabled={busy} onClick={async () => { setBusy(true); try { await download(path, filename); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }}>
      {busy ? <Spinner /> : <FileDown className="h-4 w-4" />}{label}
    </button>
  );
}

/** Stacked bar of outcomes — the at-a-glance result of a campaign. */
export function OutcomeBar({ counts, showLegend }: { counts: Record<string, number>; showLegend?: boolean }) {
  const keys = OUTCOME_ORDER.filter((k) => (counts?.[k] ?? 0) > 0);
  const total = keys.reduce((a, k) => a + counts[k], 0);
  if (!total) return <span className="text-xs text-muted">No leads yet</span>;
  return (
    <div className="min-w-[160px]">
      <div className="flex h-2.5 rounded-full overflow-hidden bg-sunken" role="img" aria-label={keys.map((k) => `${OUTCOMES[k].label}: ${counts[k]}`).join(', ')}>
        {keys.map((k) => <span key={k} className={OUTCOMES[k].dot} style={{ width: `${(counts[k] / total) * 100}%` }} title={`${OUTCOMES[k].label}: ${counts[k]}`} />)}
      </div>
      {showLegend && <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">{keys.filter((k) => k !== 'none').slice(0, 4).map((k) => <span key={k} className="text-[11px] text-muted inline-flex items-center gap-1"><span className={cx('h-1.5 w-1.5 rounded-full', OUTCOMES[k].dot)} />{OUTCOMES[k].short} <b className="text-ink tnum">{counts[k]}</b></span>)}</div>}
    </div>
  );
}

export function PriorityBadge({ p, reason }: { p?: number | null; reason?: string }) {
  if (!p) return <span className="text-xs text-muted">—</span>;
  const tone = p === 1 ? 'bg-hot text-white' : p === 2 ? 'bg-hot/15 text-hot' : 'bg-sunken text-ink';
  return <span title={reason} className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tnum whitespace-nowrap', tone)}>P{p}</span>;
}
