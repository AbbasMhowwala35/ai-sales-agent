import { useState } from 'react';
import { useApi } from '../lib/useApi';
import { qs } from '../lib/api';
import { PdfButton } from '../components/Outcome';
import { PageHeader, Panel, ErrorState, Skeleton, Empty } from '../components/ui';
import { Stat, StatRow } from '../components/Stat';
import { ActivityChart, LeadsChart, HBars, Funnel, useChartColors, ChartEmpty } from '../components/charts';
import { fmtDuration, fmtNum, STAGE_LABELS, sourceLabel } from '../lib/format';

const RANGES = [{ d: 7, l: '7 days' }, { d: 30, l: '30 days' }, { d: 90, l: '90 days' }];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function Analytics() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const path = `/analytics${qs({ from: new Date(from + 'T00:00:00').toISOString(), to: new Date(to + 'T23:59:59').toISOString() })}`;
  const { data, error, loading, reload } = useApi<any>(path);
  const c = useChartColors();
  const s = data?.summary;
  const preset = (d: number) => { setFrom(iso(new Date(Date.now() - (d - 1) * 86400_000))); setTo(iso(new Date())); };
  return (
    <>
      <PageHeader title="Analytics" description="How well your AI agent finds, reaches and converts prospects."
        actions={<div className="flex flex-wrap items-center gap-2">
          <PdfButton path={`/reports/analytics.pdf${qs({ from: new Date(from + 'T00:00:00').toISOString(), to: new Date(to + 'T23:59:59').toISOString() })}`} filename={`sales-report-${to}.pdf`} />
          <div className="flex rounded-control border border-line overflow-hidden">{RANGES.map((r) => <button key={r.d} className="px-3 h-9 text-[13px] font-semibold hover:bg-sunken border-r border-line last:border-0 bg-surface" onClick={() => preset(r.d)}>{r.l}</button>)}</div>
          <input type="date" className="input w-auto" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" className="input w-auto" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>} />
      {error && <ErrorState message={error} onRetry={reload} />}
      {loading && !data && <Skeleton className="h-96" />}
      {s && <>
        <StatRow cols={4}>
          <Stat label="Leads discovered" value={fmtNum(s.leadsDiscovered)} sub={`${fmtNum(s.qualifiedLeads)} qualified · ${fmtNum(s.approvedLeads)} approved`} />
          <Stat label="Calls initiated" value={fmtNum(s.callsInitiated)} sub={`${fmtNum(s.connected)} connected (${s.connectRate}%)`} />
          <Stat label="Missed / busy / failed" value={`${s.missed} / ${s.busy} / ${s.failed}`} sub={`${s.optOuts} opted out`} />
          <Stat label="Average call" value={fmtDuration(s.avgCallDuration)} sub="answered calls" />
        </StatRow>
        <div className="mt-4"><StatRow cols={4}>
          <Stat label="Interested prospects" value={fmtNum(s.interested)} />
          <Stat label="Meetings scheduled" value={fmtNum(s.meetingsScheduled)} accent sub={`${s.callbacks} callbacks requested`} />
          <Stat label="Converted" value={fmtNum(s.converted)} />
          <Stat label="Conversion rate" value={`${s.conversionRate}%`} sub="of all leads" />
        </StatRow></div>
        <div className="grid gap-6 lg:grid-cols-2 mt-6">
          <Panel title="Calls over time"><ActivityChart data={data.daily} /></Panel>
          <Panel title="Leads discovered"><LeadsChart data={data.daily} height={260} /></Panel>
          <Panel title="Call outcomes"><HBars data={data.callOutcomes} colors={[c.signal, c.hot, c.cold, c.danger]} /></Panel>
          <Panel title="Customer sentiment"><HBars data={data.sentiment} colors={[c.signal, c.cold, c.danger]} /></Panel>
          <Panel title="Lead temperature"><HBars data={data.temperature} colors={[c.hot, c.warm, c.cold]} /></Panel>
          <Panel title="Lead sources">{data.sources.length ? <HBars data={data.sources.map((x: any) => ({ ...x, name: sourceLabel(x.name) }))} /> : <ChartEmpty height={120} title="No leads in this period" />}</Panel>
        </div>
        <Panel title="Pipeline (all time)" className="mt-6"><Funnel stages={data.funnel.map((f: any) => ({ ...f, label: STAGE_LABELS[f.stage] }))} /></Panel>
        <Panel title="Campaign performance" className="mt-6" bodyClass="overflow-x-auto">
          {!data.campaigns.length ? <Empty title="No campaign calls in this range" /> : <PerfTable rows={data.campaigns} cols={[['name', 'Campaign'], ['calls', 'Calls'], ['answered', 'Connected'], ['connectRate', 'Connect %'], ['interested', 'Interested'], ['meetings', 'Bookings'], ['avgDuration', 'Avg call']]} />}
        </Panel>
        <Panel title="AI agent performance" className="mt-6" bodyClass="overflow-x-auto">
          {!data.agents.length ? <Empty title="No agent calls in this range" /> : <PerfTable rows={data.agents} cols={[['name', 'Agent'], ['calls', 'Calls'], ['answered', 'Conversations'], ['interestRate', 'Interest %'], ['meetings', 'Bookings'], ['avgSentiment', 'Avg sentiment'], ['avgDuration', 'Avg call']]} />}
        </Panel>
      </>}
    </>
  );
}

function PerfTable({ rows, cols }: { rows: any[]; cols: [string, string][] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr>{cols.map(([k, l], i) => <th key={k} className={`th ${i ? 'text-right' : ''}`}>{l}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}>{cols.map(([k], i) => <td key={k} className={`td tnum ${i ? 'text-right' : 'font-semibold'}`}>{k === 'avgDuration' ? fmtDuration(r[k]) : /Rate$/.test(k) ? `${r[k]}%` : r[k] ?? '—'}</td>)}</tr>)}</tbody>
    </table>
  );
}
