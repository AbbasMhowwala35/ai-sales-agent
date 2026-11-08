import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, PhoneCall, Mic } from 'lucide-react';
import { ScoreBadge } from '../components/Scorecard';
import { useApi } from '../lib/useApi';
import { qs } from '../lib/api';
import { PageHeader, Panel, Pill, RESULT_TONE, Pagination, Empty, ErrorState, TableSkeleton, cx , Pending } from '../components/ui';
import { fmtDateTime, fmtDuration } from '../lib/format';

const SENT_TONE: Record<string, string> = { positive: 'green', neutral: 'grey', negative: 'red' };

export default function Calls() {
  const [params, setParams] = useSearchParams();
  const p = Object.fromEntries(params);
  const page = Number(p.page ?? 1);
  const [search, setSearch] = useState(p.search ?? '');
  useEffect(() => { const t = setTimeout(() => { if ((p.search ?? '') !== search) setParams({ ...p, search, page: '1' }); }, 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [search]);
  const camps = useApi<any>('/campaigns');
  const path = `/calls${qs({ ...p, page, limit: 25, from: p.from ? new Date(p.from + 'T00:00:00').toISOString() : undefined, to: p.to ? new Date(p.to + 'T23:59:59').toISOString() : undefined })}`;
  const { data, error, reload } = useApi<any>(path, { poll: 10000 });
  const up = (k: string, v?: string) => { const n: any = { ...p, page: '1' }; if (v) n[k] = v; else delete n[k]; setParams(n); };
  return (
    <>
      <PageHeader title="Calls & recordings" description="Every conversation your agent has had, with recordings, transcripts and AI summaries." />
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-md"><Search className="h-4 w-4 absolute left-3 top-2.5 text-muted" /><input className="input pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by company, contact or words said on the call" aria-label="Search calls" /></div>
        <select className="input w-auto" value={p.result ?? ''} onChange={(e) => up('result', e.target.value)} aria-label="Outcome"><option value="">Any outcome</option><option value="answered">Answered</option><option value="missed">Missed</option><option value="busy">Busy</option><option value="voicemail">Voicemail</option><option value="failed">Failed</option></select>
        <select className="input w-auto" value={p.campaignId ?? ''} onChange={(e) => up('campaignId', e.target.value)} aria-label="Campaign"><option value="">All campaigns</option>{camps.data?.items?.map((c: any) => <option key={c._id} value={c._id}>{c.name}</option>)}</select>
        <select className="input w-auto" value={p.sentiment ?? ''} onChange={(e) => up('sentiment', e.target.value)} aria-label="Sentiment"><option value="">Any sentiment</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option></select>
        <input type="date" className="input w-auto" value={p.from ?? ''} onChange={(e) => up('from', e.target.value)} aria-label="From date" />
        <input type="date" className="input w-auto" value={p.to ?? ''} onChange={(e) => up('to', e.target.value)} aria-label="To date" />
      </div>
      {error && <ErrorState message={error} onRetry={reload} />}
      <Panel bodyClass="overflow-x-auto">
        {!data ? <Pending error={error} onRetry={reload} /> : !data.items.length ? <Empty icon={<PhoneCall className="h-7 w-7" />} title={Object.keys(p).length ? 'No calls match these filters' : 'No calls yet'}>{Object.keys(p).length ? 'Try a wider date range or remove a filter.' : 'Calls appear here as soon as a campaign starts dialling.'}</Empty> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Lead</th><th className="th">When</th><th className="th">Outcome</th><th className="th text-right">Duration</th><th className="th">Sentiment</th><th className="th" title="How well the agent ran the call, graded like a sales manager would">Call score</th><th className="th">Summary</th><th className="th">Campaign</th></tr></thead>
            <tbody>{data.items.map((c: any) => (
              <tr key={c._id} className="hover:bg-sunken/50">
                <td className="td max-w-[220px]"><Link to={`/calls/${c._id}`} className="font-semibold hover:underline block truncate">{c.leadId?.companyName ?? 'Deleted lead'}</Link><span className="text-xs text-muted">{c.leadId?.contactName} · {c.leadId?.phoneMasked}</span></td>
                <td className="td whitespace-nowrap text-muted">{fmtDateTime(c.createdAt)}</td>
                <td className="td">{c.status !== 'ended' ? <Pill tone="green"><span className="h-1.5 w-1.5 rounded-full bg-signal live-dot" />{c.status === 'ringing' ? 'Ringing' : c.status === 'queued' ? 'Queued' : 'Live'}</Pill> : <Pill tone={RESULT_TONE[c.result]}>{c.result}</Pill>}{c.optOut && <Pill tone="red" className="ml-1">Opt-out</Pill>}</td>
                <td className="td text-right tnum"><span className="inline-flex items-center gap-1.5">{c.recordingId?.status === 'available' && <Mic className="h-3.5 w-3.5 text-muted" aria-label="Has recording" />}{fmtDuration(c.durationSec)}</span></td>
                <td className="td">{c.sentiment?.label ? <Pill tone={SENT_TONE[c.sentiment.label]}>{c.sentiment.label}</Pill> : '—'}</td>
                <td className="td">{c.scorecard ? <ScoreBadge s={c.scorecard} /> : <span className="text-muted">—</span>}</td>
                <td className={cx('td max-w-[340px]', !c.summary && 'text-muted')}><span className="line-clamp-2">{c.summary ?? c.endReason ?? '—'}</span></td>
                <td className="td text-muted whitespace-nowrap">{c.campaignId?.name ?? 'Manual call'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {data && <Pagination page={page} total={data.total} limit={data.limit} onPage={(n) => setParams({ ...p, page: String(n) })} />}
      </Panel>
    </>
  );
}
