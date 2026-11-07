import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarCheck, PhoneCall, Video, Link2Off, CalendarDays, ExternalLink } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { post, del, qs } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { PageHeader, Panel, Spinner, Empty, ErrorState, Skeleton, Pill, cx } from '../components/ui';
import { BriefDrawer } from '../components/BriefDrawer';
import { localTime } from '../components/Outcome';

const RANGES = [{ k: 7, l: 'This week' }, { k: 14, l: '2 weeks' }, { k: 31, l: 'Month' }];

function GoogleConnect() {
  const { data, reload } = useApi<any>('/integrations/google/status');
  const can = useAuth((s) => s.can('business:write'));
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  if (data.connected) return (
    <div className="flex items-center gap-2">
      <Pill tone="green"><CalendarCheck className="h-3.5 w-3.5" />Google Calendar: {data.email ?? 'connected'}</Pill>
      {can && <button className="btn-ghost btn-sm" onClick={async () => { await del('/integrations/google'); toast.info('Google Calendar disconnected'); reload(); }}><Link2Off className="h-4 w-4" />Disconnect</button>}
    </div>
  );
  return (
    <button className="btn-primary" disabled={!can || busy} title={!data.configured ? 'Server needs Google OAuth credentials — see README' : undefined}
      onClick={async () => { setBusy(true); try { const r = await post('/integrations/google/connect'); location.href = r.url; } catch (e: any) { toast.error(e.message); setBusy(false); } }}>
      {busy ? <Spinner /> : <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden><path fill="#fff" d="M21.35 11.1H12v2.9h5.35c-.25 1.5-1.7 4.4-5.35 4.4-3.2 0-5.85-2.65-5.85-5.9S8.8 6.6 12 6.6c1.85 0 3.1.8 3.8 1.45l2.6-2.5C16.75 4 14.6 3 12 3 6.95 3 3 7 3 12s3.95 9 9 9c5.2 0 8.65-3.65 8.65-8.8 0-.6-.05-1.05-.3-1.1z" /></svg>}
      Connect Google Calendar
    </button>
  );
}

export default function Calendar() {
  const [params, setParams] = useSearchParams();
  const [days, setDays] = useState(14);
  const [briefId, setBriefId] = useState<string | null>(null);
  const from = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const to = new Date(from.getTime() + days * 86400_000);
  const { data, error, reload } = useApi<any>(`/integrations/calendar/events${qs({ from: from.toISOString(), to: to.toISOString() })}`);
  useEffect(() => {
    const g = params.get('google');
    if (!g) return;
    if (g === 'connected') toast.success('Google Calendar connected — new meetings will include a Google Meet link');
    else if (g === 'no_refresh_token') toast.error('Google didn’t grant offline access. Remove Dialstack from your Google account permissions and connect again.');
    else toast.error('Couldn’t connect Google Calendar. Please try again.');
    setParams({}, { replace: true });
  }, [params, setParams]);

  const items = useMemo(() => {
    if (!data) return [];
    const ours = data.appointments.map((a: any) => ({ kind: 'ours', at: a.startsAt, end: a.endsAt, a }));
    const theirs = data.googleEvents.map((e: any) => ({ kind: 'google', at: e.startsAt, end: e.endsAt, e }));
    return [...ours, ...theirs].sort((x, y) => +new Date(x.at) - +new Date(y.at));
  }, [data]);
  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const it of items) { const k = new Date(it.at).toDateString(); m.set(k, [...(m.get(k) ?? []), it]); }
    return [...m.entries()];
  }, [items]);
  const t = (d: string) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  return (
    <>
      <PageHeader title="Calendar" description="Meetings and callbacks your AI agent booked, alongside your real Google Calendar — with who each meeting is with and what they want." actions={<GoogleConnect />} />
      <div className="flex gap-2 mb-4">
        {RANGES.map((r) => <button key={r.k} onClick={() => setDays(r.k)} aria-pressed={days === r.k} className={cx('h-9 px-3.5 rounded-full border text-[13px] font-semibold', days === r.k ? 'bg-ink text-paper border-ink' : 'bg-surface border-line hover:bg-sunken')}>{r.l}</button>)}
      </div>
      {error && <ErrorState message={error} onRetry={reload} />}
      {data?.googleError && <p className="rounded-control bg-hot/10 p-3 text-[13px] mb-4">{data.googleError}</p>}
      {!data && !error && <Skeleton className="h-80" />}
      {data && !items.length && <Panel><Empty icon={<CalendarDays className="h-7 w-7" />} title="Nothing booked in this period">When your agent books a meeting or callback it appears here{data.connected ? ' and on your Google Calendar' : ''}.</Empty></Panel>}
      <div className="space-y-6">
        {byDay.map(([day, list]) => (
          <section key={day}>
            <h2 className="text-[13px] font-semibold text-muted mb-2">{new Date(day).toDateString() === new Date().toDateString() ? 'Today' : new Date(day).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
            <ul className="space-y-2">
              {list.map((it: any, i: number) => it.kind === 'google' ? (
                <li key={`g${i}`} className="rounded-control border border-dashed border-line px-4 py-3 flex items-center gap-4 text-[13px] text-muted">
                  <span className="tnum w-20 shrink-0">{it.e.allDay ? 'All day' : t(it.at)}</span>
                  <span className="flex-1 truncate">{it.e.title}</span>
                  <span className="text-xs">Google Calendar</span>
                </li>
              ) : (
                <li key={it.a._id} className={cx('panel px-4 py-3 flex flex-wrap items-center gap-4 border-l-4', it.a.type === 'callback' ? 'border-l-hot' : 'border-l-signal')}>
                  <div className="w-20 shrink-0"><p className="tnum font-display text-lg font-[650] leading-none">{t(it.at)}</p><p className="text-[11px] text-muted mt-1">your time</p></div>
                  <div className="flex-1 min-w-[220px]">
                    <p className="font-semibold flex items-center gap-2">{it.a.type === 'callback' ? <PhoneCall className="h-4 w-4 text-hot" /> : <Video className="h-4 w-4 text-signal" />}
                      <Link to={`/leads/${it.a.leadId?._id}`} className="hover:underline">{it.a.leadId?.companyName ?? 'Lead'}</Link>
                      {it.a.leadId?.category && <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-muted">{it.a.leadId.category}</span>}
                    </p>
                    <p className="text-[13px] text-muted">{[it.a.leadId?.contactName, it.a.leadId?.designation].filter(Boolean).join(', ')}{it.a.type === 'callback' ? ' · AI calls them back' : it.a.with === 'owner' ? ' · meeting with the founder' : ' · meeting with your specialist'} · {localTime(it.at, it.a.timezone)} their time</p>
                    {it.a.leadId?.brief?.summary && <p className="text-[13px] mt-1 line-clamp-1">{it.a.leadId.brief.summary}</p>}
                  </div>
                  <div className="flex gap-2">
                    {it.a.leadId?.brief?.summary && <button className="btn-secondary btn-sm" onClick={() => setBriefId(it.a.leadId._id)}>Meeting brief</button>}
                    {it.a.meetLink ? <a className="btn-primary btn-sm" href={it.a.meetLink} target="_blank" rel="noreferrer noopener"><Video className="h-4 w-4" />Join Meet</a>
                      : it.a.type !== 'callback' && <span className="text-xs text-muted self-center">{data.connected ? 'No Meet link' : 'Connect Google for a Meet link'}</span>}
                    {it.a.calendarEventId && <span title="On your Google Calendar"><ExternalLink className="h-4 w-4 text-muted" /></span>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <BriefDrawer leadId={briefId} onClose={() => setBriefId(null)} />
    </>
  );
}
