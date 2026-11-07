import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Check, X, Download, LayoutList, Columns3, Users, Megaphone, Ban } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { post, patch, qs, api } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { PageHeader, Panel, Pill, TempPill, ScoreBar, Spinner, Modal, Field, Pagination, Empty, ErrorState, TableSkeleton, Tabs, Confirm, STATUS_TONE, cx } from '../components/ui';
import { STAGES, STAGE_LABELS, sourceLabel, timeAgo } from '../lib/format';
import { OutcomeBadge, OUTCOMES, PdfButton, PriorityBadge, localTime, type OutcomeKey } from '../components/Outcome';
import { BriefDrawer } from '../components/BriefDrawer';

const OUTCOME_TABS: { id: string; label: string; keys?: OutcomeKey[] }[] = [
  { id: 'all', label: 'Everyone' },
  { id: 'meeting', label: 'Meetings', keys: ['meeting'] },
  { id: 'callback', label: 'Call back', keys: ['callback'] },
  { id: 'interested', label: 'Interested', keys: ['interested'] },
  { id: 'nurture', label: 'Follow up later', keys: ['nurture'] },
  { id: 'busy,no_answer', label: 'Busy / no answer', keys: ['busy', 'no_answer'] },
  { id: 'not_interested', label: 'Not interested', keys: ['not_interested'] },
  { id: 'do_not_call', label: 'Do not call', keys: ['do_not_call'] },
  { id: 'none', label: 'Not called yet', keys: ['none'] },
];

export default function Leads() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'table' | 'board'>(() => { try { return (localStorage.getItem('leads-view') as any) ?? 'table'; } catch { return 'table'; } });
  useEffect(() => { try { localStorage.setItem('leads-view', view); } catch { /* */ } }, [view]);
  const p = Object.fromEntries(params);
  const page = Number(p.page ?? 1);
  const [search, setSearch] = useState(p.search ?? '');
  useEffect(() => { const t = setTimeout(() => { if ((p.search ?? '') !== search) setParams({ ...p, search, page: '1' }); }, 300); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [search]);
  const path = `/leads${qs({ ...p, page, limit: view === 'board' ? 200 : 25, sort: p.sort ?? 'priority' })}`;
  const { data, error, loading, reload } = useApi<any>(path);
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => { setSel(new Set()); }, [path]);
  const [adding, setAdding] = useState(false);
  const [toCampaign, setToCampaign] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const { can } = useAuth();
  const team = useApi<any>('/team');
  const counts = useApi<any>('/leads/outcomes').data?.counts ?? {};
  const categories = useApi<any>('/leads/categories').data?.categories ?? [];
  const [briefId, setBriefId] = useState<string | null>(null);
  const up = (k: string, v?: string) => { const n: any = { ...p, page: '1' }; if (v) n[k] = v; else delete n[k]; setParams(n); };

  const bulk = async (action: string, extra: any = {}) => {
    try { const r = await post('/leads/bulk', { ids: [...sel], action, ...extra }); toast.success(`${r.modified} lead${r.modified === 1 ? '' : 's'} updated`); setSel(new Set()); reload(); }
    catch (e: any) { toast.error(e.message); }
  };
  const exportCsv = async () => {
    const res: Response = await api(`/leads/export${qs(p)}`, { raw: true });
    if (!res.ok) return toast.error('Export failed');
    const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = 'leads.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const items: any[] = data?.items ?? [];
  const allSel = items.length > 0 && items.every((l) => sel.has(l._id));

  return (
    <>
      <PageHeader title="Leads" description="Review, approve and work every prospect your agent discovers."
        actions={<>
          <div className="flex rounded-control border border-line overflow-hidden bg-surface" role="group" aria-label="View">
            <button className={cx('h-9 px-3', view === 'table' && 'bg-sunken')} onClick={() => setView('table')} aria-pressed={view === 'table'} aria-label="Table view"><LayoutList className="h-4 w-4" /></button>
            <button className={cx('h-9 px-3 border-l border-line', view === 'board' && 'bg-sunken')} onClick={() => setView('board')} aria-pressed={view === 'board'} aria-label="Pipeline board"><Columns3 className="h-4 w-4" /></button>
          </div>
          {can('leads:approve') && <button className="btn-ghost" onClick={exportCsv}><Download className="h-4 w-4" />CSV</button>}
          <PdfButton path={`/reports/leads.pdf${qs({ outcome: p.outcome, approval: p.approval, temperature: p.temperature })}`} filename="leads-report.pdf" />
          {can('leads:write') && <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add lead</button>}
        </>} />
      <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1" role="tablist" aria-label="What they want">
        {OUTCOME_TABS.map((t) => {
          const on = (p.outcome ?? 'all') === t.id;
          const n = t.keys ? t.keys.reduce((a, k) => a + (counts[k] ?? 0), 0) : undefined;
          const d = t.keys ? OUTCOMES[t.keys[0]] : null;
          return (
            <button key={t.id} role="tab" aria-selected={on} onClick={() => up('outcome', t.id === 'all' ? undefined : t.id)}
              className={cx('flex items-center gap-2 h-9 px-3.5 rounded-full border text-[13px] font-semibold whitespace-nowrap', on ? 'bg-ink text-paper border-ink' : 'bg-surface border-line hover:bg-sunken')}>
              {d && <span className={cx('h-2 w-2 rounded-full', d.dot)} />}{t.label}{n !== undefined && <span className={cx('tnum text-xs', on ? 'opacity-70' : 'text-muted')}>{n}</span>}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-md"><Search className="h-4 w-4 absolute left-3 top-2.5 text-muted" /><input className="input pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, contact, phone or email" aria-label="Search leads" /></div>
        <select className="input w-auto" value={p.temperature ?? ''} onChange={(e) => up('temperature', e.target.value)} aria-label="Temperature"><option value="">Any temperature</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>
        <select className="input w-auto" value={p.category ?? ''} onChange={(e) => up('category', e.target.value)} aria-label="Category"><option value="">All categories</option>{categories.map((c: any) => <option key={c.key} value={c.key}>{c.name} ({c.total})</option>)}</select>
        <div className="flex rounded-control border border-line overflow-hidden bg-surface" role="group" aria-label="Priority">
          {[['', 'Any priority'], ['1', 'P1'], ['2', 'P2'], ['3', 'P3']].map(([k, l]) => <button key={k} onClick={() => up('priority', k || undefined)} aria-pressed={(p.priority ?? '') === k} className={cx('h-9 px-3 text-[13px] font-semibold border-r border-line last:border-0', (p.priority ?? '') === k ? 'bg-ink text-paper' : 'hover:bg-sunken')}>{l}</button>)}
        </div>
        <select className="input w-auto" value={p.approval ?? ''} onChange={(e) => up('approval', e.target.value)} aria-label="Approval"><option value="">Any approval</option><option value="pending">Needs approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
        {view === 'table' && <select className="input w-auto" value={p.status ?? ''} onChange={(e) => up('status', e.target.value)} aria-label="Stage"><option value="">Any stage</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select>}
        <select className="input w-auto" value={p.assignedTo ?? ''} onChange={(e) => up('assignedTo', e.target.value)} aria-label="Owner"><option value="">Anyone</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option>{team.data?.members?.filter((m: any) => m.status === 'active').map((m: any) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>
        <select className="input w-auto" value={p.sort ?? ''} onChange={(e) => up('sort', e.target.value)} aria-label="Sort"><option value="">Highest priority first</option><option value="-score">Best fit first</option><option value="-createdAt">Newest first</option><option value="companyName">Company A–Z</option><option value="-lastContactedAt">Recently contacted</option></select>
        {p.runId && <button className="btn-ghost btn-sm h-9" onClick={() => up('runId')}><X className="h-4 w-4" />From one discovery run</button>}
      </div>

      {sel.size > 0 && (
        <div className="sticky top-16 z-10 mb-3 panel flex flex-wrap items-center gap-2 px-4 py-2.5 border-signal/40 bg-signal-soft">
          <span className="font-semibold text-[13px] mr-2 tnum">{sel.size} selected</span>
          {can('leads:approve') && <><button className="btn-primary btn-sm" onClick={() => bulk('approve')}><Check className="h-4 w-4" />Approve for calling</button><button className="btn-secondary btn-sm" onClick={() => bulk('reject')}><Ban className="h-4 w-4" />Reject</button></>}
          {can('campaigns:write') && <button className="btn-secondary btn-sm" onClick={() => setToCampaign(true)}><Megaphone className="h-4 w-4" />Add to campaign</button>}
          <select className="input h-8 w-auto text-[13px]" value="" onChange={(e) => e.target.value && bulk('assign', { assignedTo: e.target.value === 'none' ? null : e.target.value })} aria-label="Assign selected"><option value="">Assign to…</option><option value="none">Nobody</option>{team.data?.members?.filter((m: any) => m.status === 'active').map((m: any) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>
          <select className="input h-8 w-auto text-[13px]" value="" onChange={(e) => e.target.value && bulk('status', { status: e.target.value })} aria-label="Move selected to stage"><option value="">Move to stage…</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select>
          {can('leads:approve') && <button className="btn-ghost btn-sm" onClick={() => bulk('rescore')}>Re-score</button>}
          {can('leads:delete') && <button className="btn-ghost btn-sm text-danger" onClick={() => setConfirmDel(true)}>Delete</button>}
          <button className="btn-ghost btn-sm ml-auto" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={reload} />}
      {view === 'board' ? <Board items={items} loading={loading && !data} onMoved={reload} /> : (
        <Panel bodyClass="overflow-x-auto">
          {!data ? <TableSkeleton /> : !items.length ? (
            <Empty icon={<Users className="h-7 w-7" />} title={p.search || p.temperature || p.status ? 'No leads match these filters' : 'No leads yet'} action={!p.search && <Link className="btn-primary" to="/lead-generation">Find leads</Link>}>
              {p.search || p.temperature || p.status ? 'Try removing a filter.' : 'Run lead discovery or import a CSV to fill your pipeline.'}
            </Empty>
          ) : (
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th w-10"><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(items.map((l) => l._id)))} aria-label="Select all" className="accent-[rgb(var(--signal))]" /></th>
                <th className="th">Priority</th><th className="th">Company</th><th className="th">What they want</th><th className="th">Contact</th><th className="th">Fit</th><th className="th">Stage</th><th className="th">Approval</th><th className="th">Owner</th><th className="th">Added</th>
              </tr></thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l._id} className={cx('hover:bg-sunken/50', sel.has(l._id) && 'bg-signal-soft/40')}>
                    <td className="td"><input type="checkbox" checked={sel.has(l._id)} onChange={() => { const n = new Set(sel); n.has(l._id) ? n.delete(l._id) : n.add(l._id); setSel(n); }} aria-label={`Select ${l.companyName}`} className="accent-[rgb(var(--signal))]" /></td>
                    <td className="td min-w-[170px] max-w-[210px]"><div className="flex items-start gap-2"><PriorityBadge p={l.priority} reason={l.priorityReason} />{l.priorityReason && <span className="text-[12px] text-muted leading-snug">{l.priorityReason}</span>}</div></td>
                    <td className="td max-w-[240px]">
                      <Link to={`/leads/${l._id}`} className="font-semibold hover:underline block truncate">{l.companyName}</Link>
                      <span className="text-xs text-muted truncate block">{[l.category, l.location?.city, l.location?.country].filter(Boolean).join(' · ') || l.domain}</span>
                    </td>
                    <td className="td min-w-[200px] max-w-[280px]">
                      <span className="inline-flex items-center gap-1.5"><OutcomeBadge o={l.outcome} />{l.brief?.summary && <button className="text-[11px] font-semibold text-signal underline" onClick={() => setBriefId(l._id)}>Brief</button>}</span>
                      {(l.outcomeNote || l.followUpAt) && <p className="text-xs text-muted mt-1 leading-snug line-clamp-2">{l.followUpAt && ['callback', 'nurture', 'meeting', 'interested'].includes(l.outcome) ? <span className="font-semibold text-ink">{localTime(l.followUpAt, l.localTz)} · </span> : null}{l.outcomeNote}</p>}
                    </td>
                    <td className="td max-w-[200px]"><span className="block truncate">{l.contactName ?? '—'}</span><span className="text-xs text-muted block truncate">{l.designation}{l.doNotCall && <span className="text-danger font-semibold"> · Do not call</span>}</span></td>
                    <td className="td"><div className="flex items-center gap-2"><TempPill t={l.temperature} /><ScoreBar score={l.score} /></div></td>
                    <td className="td whitespace-nowrap">{STAGE_LABELS[l.status]}</td>
                    <td className="td"><Pill tone={STATUS_TONE[l.approval]}>{l.approval}</Pill></td>
                    <td className="td text-muted whitespace-nowrap">{l.assignedTo?.name ?? '—'}</td>
                    <td className="td text-muted whitespace-nowrap">{timeAgo(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data && <Pagination page={page} total={data.total} limit={data.limit} onPage={(n) => setParams({ ...p, page: String(n) })} />}
        </Panel>
      )}
      <BriefDrawer leadId={briefId} onClose={() => setBriefId(null)} />
      <AddLead open={adding} onClose={() => setAdding(false)} onCreated={reload} />
      <AddToCampaign open={toCampaign} onClose={() => setToCampaign(false)} ids={[...sel]} />
      <Confirm open={confirmDel} onClose={() => setConfirmDel(false)} danger title={`Delete ${sel.size} leads?`} confirmLabel="Delete leads" message="Their activity history stays in call records, but the leads can’t be recovered." onConfirm={() => bulk('delete')} />
    </>
  );
}

function Board({ items, loading, onMoved }: { items: any[]; loading: boolean; onMoved: () => void }) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const can = useAuth((s) => s.can('leads:write'));
  const cols = useMemo(() => STAGES.map((s) => ({ s, items: items.filter((l) => l.status === s) })), [items]);
  const move = async (id: string, status: string) => {
    try { await patch(`/leads/${id}`, { status }); onMoved(); } catch (e: any) { toast.error(e.message); }
  };
  if (loading) return <TableSkeleton />;
  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
      {cols.map(({ s, items }) => (
        <div key={s} onDragOver={(e) => { if (can) { e.preventDefault(); setOver(s); } }} onDragLeave={() => setOver(null)} onDrop={() => { if (drag) move(drag, s); setDrag(null); setOver(null); }}
          className={cx('w-[260px] shrink-0 rounded-panel bg-sunken/70 p-2 border-2', over === s ? 'border-signal' : 'border-transparent')}>
          <div className="flex items-center justify-between px-2 py-1.5"><h3 className="text-[13px] font-semibold">{STAGE_LABELS[s]}</h3><span className="text-xs text-muted tnum">{items.length}</span></div>
          <div className="space-y-2 min-h-[80px]">
            {items.map((l) => (
              <Link key={l._id} to={`/leads/${l._id}`} draggable={can} onDragStart={() => setDrag(l._id)} className="block bg-surface border border-line rounded-control p-3 hover:border-signal/60 cursor-grab active:cursor-grabbing">
                <div className="flex items-start justify-between gap-2"><span className="font-semibold text-[13px] leading-snug">{l.companyName}</span><TempPill t={l.temperature} /></div>
                <p className="text-xs text-muted mt-1 truncate">{l.contactName ?? 'No contact'}{l.designation ? ` · ${l.designation}` : ''}</p>
                <div className="mt-2"><ScoreBar score={l.score} /></div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AddLead({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const blank = { companyName: '', category: '', contactName: '', designation: '', phone: '', email: '', website: '', city: '', country: '', industry: '' };
  const [f, setF] = useState(blank); const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const submit = async () => {
    setBusy(true);
    try {
      const body: any = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
      const l = await post('/leads', { ...body, consent: consent ? 'granted' : 'unknown' });
      toast.success('Lead added'); onCreated(); onClose(); setF(blank); nav(`/leads/${l._id}`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const field = (k: keyof typeof blank, label: string, ph?: string) => <Field label={label}><input className="input" value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>;
  return (
    <Modal open={open} onClose={onClose} title="Add a lead" wide dirty={Object.values(f).some(Boolean)} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!f.companyName || busy} onClick={submit}>{busy && <Spinner />}Add lead</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('companyName', 'Company')}{field('category', 'Category', 'e.g. Salons')}{field('industry', 'Industry')}{field('country', 'Country', 'e.g. USA')}{field('contactName', 'Contact name')}{field('designation', 'Designation')}
        {field('phone', 'Phone', '+91 98765 43210')}{field('email', 'Business email')}{field('website', 'Website')}{field('city', 'City')}
        <label className="sm:col-span-2 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="accent-[rgb(var(--signal))]" />This contact has agreed to be called</label>
      </div>
    </Modal>
  );
}

function AddToCampaign({ open, onClose, ids }: { open: boolean; onClose: () => void; ids: string[] }) {
  const { data } = useApi<any>(open ? '/campaigns' : null);
  const [cid, setCid] = useState(''); const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const camps = data?.items?.filter((c: any) => c.status !== 'completed') ?? [];
  return (
    <Modal open={open} onClose={onClose} title={`Add ${ids.length} leads to a campaign`} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!cid || busy} onClick={async () => { setBusy(true); try { const r = await post(`/campaigns/${cid}/leads`, { leadIds: ids }); toast.success(`${r.added} added${r.skipped ? ` · ${r.skipped} skipped (not approved, no phone or Do-Not-Call)` : ''}`); onClose(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }}>{busy && <Spinner />}Add to campaign</button></>}>
      {!camps.length ? <p className="text-muted">No open campaigns. <button className="text-signal font-semibold" onClick={() => nav('/campaigns?new=1')}>Create one</button></p> : (
        <Field label="Campaign" hint="Only approved leads with a phone number who aren’t on the Do-Not-Call list are added.">
          <select className="input" value={cid} onChange={(e) => setCid(e.target.value)}><option value="">Choose a campaign</option>{camps.map((c: any) => <option key={c._id} value={c._id}>{c.name} ({c.status})</option>)}</select>
        </Field>
      )}
    </Modal>
  );
}
