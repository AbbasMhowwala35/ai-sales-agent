import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radar, Upload, CircleAlert, FileDown } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { post, upload, download } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { PageHeader, Panel, Field, TagInput, Spinner, Pill, STATUS_TONE, Empty, TableSkeleton, Toggle, cx , Pending } from '../components/ui';
import { fmtDateTime, sourceLabel } from '../lib/format';

export default function LeadGeneration() {
  const can = useAuth((s) => s.can('leadgen:run'));
  const providers = useApi<any>('/lead-generation/providers');
  const preview = useApi<any>('/lead-generation/preview-query');
  const [running, setRunning] = useState(false);
  const runs = useApi<any>('/lead-generation/runs', { poll: running ? 2000 : 0 });
  const nowRunning = !!runs.data?.runs?.some((r: any) => ['queued', 'running'].includes(r.status));
  if (nowRunning !== running) setRunning(nowRunning);
  const [q, setQ] = useState<any>(null);
  const [provider, setProvider] = useState('auto');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (preview.data && !q) setQ({ ...preview.data, limit: 25 }); }, [preview.data, q]);
  const configured = providers.data?.providers?.filter((p: any) => p.configured) ?? [];
  const start = async () => {
    setBusy(true);
    try { await post('/lead-generation/runs', { provider, ...q }); toast.success('Lead discovery started — new leads will appear for approval'); runs.reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const emptyIcp = q && !q.keywords.length && !q.industries.length;
  return (
    <>
      <PageHeader title="Lead generation" description="Your agent searches authorised directories and data providers for companies that match your ideal customer, scores every match and removes duplicates." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Panel title="Find new leads">
          {!q ? <TableSkeleton rows={3} /> : (
            <fieldset disabled={!can} className="space-y-5">
              {emptyIcp && <div className="flex gap-2 rounded-control bg-hot/10 p-3 text-[13px]"><CircleAlert className="h-4 w-4 text-hot shrink-0 mt-0.5" /><p>No ideal customer profile yet. <Link className="underline font-semibold" to="/settings?tab=icp">Add industries and keywords</Link> so discovery and scoring know what to look for.</p></div>}
              <div>
                <span className="label">Data source</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[{ id: 'auto', label: 'Best available', configured: true }, ...(providers.data?.providers ?? [])].map((p: any) => (
                    <button key={p.id} type="button" disabled={!p.configured} onClick={() => setProvider(p.id)} aria-pressed={provider === p.id}
                      className={cx('text-left rounded-control border p-3 disabled:opacity-50', provider === p.id ? 'border-signal bg-signal-soft/50' : 'border-line hover:bg-sunken')}>
                      <span className="font-semibold block text-[13px]">{p.label}</span>
                      <span className="text-xs text-muted">{p.id === 'auto' ? (configured.find((c: any) => c.id !== 'sandbox')?.label ?? 'Sandbox until a provider key is added') : p.configured ? 'Connected' : 'Add API key on the server to enable'}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Keywords"><TagInput value={q.keywords} onChange={(v) => setQ({ ...q, keywords: v })} placeholder="dental clinic, boutique…" /></Field>
                <Field label="Industries"><TagInput value={q.industries} onChange={(v) => setQ({ ...q, industries: v })} /></Field>
                <Field label="Locations"><TagInput value={q.locations} onChange={(v) => setQ({ ...q, locations: v })} placeholder="Pune, India" /></Field>
                <Field label="Decision-maker roles" hint="Used by contact providers such as Apollo."><TagInput value={q.roles} onChange={(v) => setQ({ ...q, roles: v })} /></Field>
                <Field label="Category" hint="Leads are filed under this, e.g. Salons, Dentists."><input className="input" value={q.category ?? ''} onChange={(e) => setQ({ ...q, category: e.target.value })} placeholder="e.g. Salons" /></Field>
                <Field label="How many leads"><input className="input" type="number" min={1} max={200} value={q.limit} onChange={(e) => setQ({ ...q, limit: Math.min(200, Math.max(1, Number(e.target.value))) })} /></Field>
              </div>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <p className="text-xs text-muted max-w-[52ch]">Pre-filled from your ideal customer profile. Only public business listings and authorised APIs are used; numbers on your Do-Not-Call list are flagged automatically.</p>
                <button className="btn-primary" onClick={start} disabled={busy || !can}>{busy ? <Spinner /> : <Radar className="h-4 w-4" />}Start discovery</button>
              </div>
            </fieldset>
          )}
        </Panel>
        <CsvImport onDone={runs.reload} disabled={!can} />
      </div>
      <Panel title="Discovery history" className="mt-6" bodyClass="overflow-x-auto">
        {!runs.data ? <Pending error={runs.error} onRetry={runs.reload} /> : !runs.data.runs.length ? <Empty icon={<Radar className="h-7 w-7" />} title="No discovery runs yet">Start your first run above — it usually finishes in under a minute.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Started</th><th className="th">Source</th><th className="th">Search</th><th className="th">Status</th><th className="th text-right">Found</th><th className="th text-right">New</th><th className="th text-right">Duplicates</th><th className="th text-right">Skipped</th><th className="th" /></tr></thead>
            <tbody>
              {runs.data.runs.map((r: any) => (
                <tr key={r._id}>
                  <td className="td whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                  <td className="td">{sourceLabel(r.provider)}</td>
                  <td className="td text-muted max-w-[260px] truncate">{r.provider === 'csv_import' ? r.query?.file : [...(r.query?.keywords ?? []), ...(r.query?.locations ?? [])].join(', ') || '—'}</td>
                  <td className="td"><Pill tone={STATUS_TONE[r.status]}>{['queued', 'running'].includes(r.status) && <Spinner className="h-3 w-3" />}{r.status}</Pill>{r.error && <p className="text-xs text-danger mt-1 max-w-[240px]">{r.error}</p>}</td>
                  <td className="td text-right tnum">{r.found}</td>
                  <td className="td text-right tnum font-semibold">{r.created}</td>
                  <td className="td text-right tnum text-muted">{r.duplicates}</td>
                  <td className="td text-right tnum text-muted" title="Missing a required phone number">{r.rejected}</td>
                  <td className="td text-right">{r.created > 0 && <Link className="text-signal font-semibold text-[13px] whitespace-nowrap" to={`/leads?runId=${r._id}&approval=pending`}>Review leads</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

function CsvImport({ onDone, disabled }: { onDone: () => void; disabled: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async (f: File) => {
    const fd = new FormData(); fd.append('file', f); if (consent) fd.append('consent', 'granted');
    setBusy(true);
    try { const r = await upload('/lead-generation/import', fd); toast.success(`Imported ${r.created} leads · ${r.duplicates} duplicates skipped`); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <Panel title="Import your own list" className="self-start">
      <p className="text-[13px] text-muted mb-3">Upload a CSV of contacts you already have permission to call — a CRM export or event sign-ups. The first row must be the column names; only <b className="text-ink">company</b> and <b className="text-ink">phone</b> are required (phone with country code).</p>
      <div className="overflow-x-auto rounded-control border border-line mb-3">
        <table className="text-[11px] whitespace-nowrap">
          <thead><tr className="bg-sunken">{['company', 'name', 'title', 'phone', 'email', 'website', 'city', 'country', 'category'].map((h) => <th key={h} className="px-2 py-1.5 text-left font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            <tr className="border-t border-line">{['Luxe Hair Studio', 'Emily Johnson', 'Owner', '+1 512 555 0142', 'emily@luxehair.com', 'luxehair.com', 'Austin', 'USA', 'Salons'].map((c, i) => <td key={i} className="px-2 py-1.5">{c}</td>)}</tr>
            <tr className="border-t border-line">{['Willow Day Spa', 'Sophie Clarke', 'Founder', '+44 20 7946 0321', '', '', 'London', 'United Kingdom', 'Spas'].map((c, i) => <td key={i} className="px-2 py-1.5 text-muted">{c || '—'}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <button className="btn-ghost btn-sm mb-3" onClick={() => download('/lead-generation/sample.csv', 'lead-import-sample.csv').catch((e) => toast.error(e.message))}><FileDown className="h-4 w-4" />Download sample CSV</button>
      <Toggle checked={consent} onChange={setConsent} label="These contacts gave consent" description="Marks imported leads as consented to be contacted." />
      <input ref={ref} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && go(e.target.files[0])} />
      <button className="btn-secondary w-full mt-4" disabled={disabled || busy} onClick={() => ref.current?.click()}>{busy ? <Spinner /> : <Upload className="h-4 w-4" />}Upload CSV</button>
    </Panel>
  );
}
