import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Play, Pause, Square, Pencil, UserMinus, Radar, MessageSquareQuote, ChevronDown } from 'lucide-react';
import { OutcomeBadge, OutcomeBar, OUTCOMES, OUTCOME_ORDER, PdfButton, localTime } from '../components/Outcome';
import { BriefDrawer } from '../components/BriefDrawer';
import { useApi } from '../lib/useApi';
import { post, patch, del } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { Panel, Pill, STATUS_TONE, Spinner, ErrorState, Skeleton, Modal, Confirm, TempPill, Tabs, cx } from '../components/ui';
import { CampaignFields, ResearchFields, finalLocations, areaSummary } from '../components/CampaignForm';
import { Stat, StatRow } from '../components/Stat';
import { fmtDuration, fmtDateTime, STAGE_LABELS } from '../lib/format';
import { useNavigate } from 'react-router-dom';

const CL_LABEL: Record<string, string> = { queued: 'Waiting', calling: 'Calling now', completed: 'Reached', retry: 'Will retry', exhausted: 'No answer after retries', skipped: 'Skipped' };
const CL_TONE: Record<string, string> = { queued: 'grey', calling: 'green', completed: 'blue', retry: 'amber', exhausted: 'red', skipped: 'grey' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CampaignDetail() {
  const { id } = useParams();
  const { data: c, error, reload } = useApi<any>(`/campaigns/${id}`, { poll: 4000 });
  const can = useAuth((s) => s.can('campaigns:write'));
  const [edit, setEdit] = useState<any>(null);
  const [confirm, setConfirm] = useState<'complete' | 'delete' | null>(null);
  const [filter, setFilter] = useState('all');
  const [briefId, setBriefId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const agents = useApi<any>(edit ? '/agents' : null);
  const nav = useNavigate();
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!c) return <Skeleton className="h-96" />;
  const act = async (a: string) => { setBusy(true); try { await post(`/campaigns/${c._id}/${a}`); reload(); toast.success({ start: 'Campaign started', resume: 'Campaign resumed', pause: 'Campaign paused — calls in progress will finish', complete: 'Campaign completed' }[a]!); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const s = c.stats; const L = s.leads ?? {}; const C = s.calls ?? {};
  const leads = c.leads.filter((x: any) => filter === 'all' || (x.leadId?.outcome ?? 'none') === filter);
  const oc: Record<string, number> = s.outcomes ?? {};
  return (
    <>
      <Link to="/campaigns" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-3"><ArrowLeft className="h-4 w-4" />Campaigns</Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-6">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-[26px] font-[650]">{c.name}</h1>{c.category && <span className="rounded-full bg-sunken px-2.5 py-0.5 text-[12px] font-semibold text-muted">{c.category}</span>}<Pill tone={STATUS_TONE[c.status]}>{c.status === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-signal live-dot" />}{c.status}</Pill></div>
          <p className="text-muted mt-1">{c.agentId?.name} calls {c.schedule.days.map((d: number) => DAYS[d]).join(', ')} · {c.schedule.startTime}–{c.schedule.endTime} ({c.schedule.timezone}) · up to {c.dailyLimit}/day, {c.maxConcurrent} at once · {c.maxRetries} retries</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PdfButton path={`/reports/campaigns/${c._id}.pdf`} filename={`campaign-${c.name}.pdf`} label="PDF report" className="btn-ghost" />
        {can && <>
          {c.status !== 'completed' && <button className="btn-ghost" onClick={() => setEdit(structuredClone(c))}><Pencil className="h-4 w-4" />Edit</button>}
          {c.status === 'active' && <button className="btn-secondary" disabled={busy} onClick={() => act('pause')}><Pause className="h-4 w-4" />Pause</button>}
          {['draft', 'paused'].includes(c.status) && <button className="btn-primary" disabled={busy} onClick={() => act(c.status === 'draft' ? 'start' : 'resume')}>{busy ? <Spinner /> : <Play className="h-4 w-4" />}{c.status === 'draft' ? 'Start campaign' : 'Resume'}</button>}
          {c.status !== 'completed' && <button className="btn-ghost" onClick={() => setConfirm('complete')}><Square className="h-4 w-4" />Finish</button>}
          {c.status !== 'active' && <button className="btn-ghost text-danger" onClick={() => setConfirm('delete')}>Delete</button>}
        </>}
        </div>
      </div>
      <StatRow cols={6}>
        <Stat label="Leads" value={L.total ?? 0} sub={`${L.queued ?? 0} waiting`} />
        <Stat label="Calls placed" value={C.total ?? 0} />
        <Stat label="Connected" value={C.answered ?? 0} sub={C.total ? `${Math.round(((C.answered ?? 0) / C.total) * 100)}%` : undefined} />
        <Stat label="Missed / busy" value={`${(C.missed ?? 0) + (C.voicemail ?? 0)} / ${C.busy ?? 0}`} />
        <Stat label="Will retry" value={L.retry ?? 0} />
        <Stat label="Talk time" value={fmtDuration(s.totalDuration)} />
      </StatRow>
      {c.pitch && <PitchCard p={c.pitch} agent={c.agentId?.name ?? 'Your agent'} category={c.category} />}
      {c.research?.enabled && (
        <section className="panel mt-6 p-5 grid gap-4 md:grid-cols-[1fr_auto] items-center">
          <div className="flex gap-3">
            <span className="h-10 w-10 rounded-control bg-signal-soft text-signal-ink flex items-center justify-center shrink-0"><Radar className="h-5 w-5" /></span>
            <div>
              <p className="font-semibold">Finding {c.research.keywords?.join(', ') || 'prospects'} in {areaSummary({ locations: c.research.locations ?? [], countries: c.research.countries ?? [] })}, {c.research.frequency}</p>
              <p className="text-[13px] text-muted">{c.research.leadsPerRun} per search · auto-approves fit ≥ {c.research.autoApproveMinScore} · {c.endDate ? `until ${new Date(c.endDate).toDateString()}` : 'no end date'}</p>
            </div>
          </div>
          <dl className="flex gap-6 text-[13px]">
            <div><dt className="text-muted">Found</dt><dd className="font-display text-xl font-[650] tnum">{c.research.totalFound ?? 0}</dd></div>
            <div><dt className="text-muted">Added to calls</dt><dd className="font-display text-xl font-[650] tnum text-signal">{c.research.totalAdded ?? 0}</dd></div>
            <div><dt className="text-muted">Next search</dt><dd className="font-semibold pt-1">{c.status === 'active' && c.research.nextRunAt ? fmtDateTime(c.research.nextRunAt) : c.status === 'active' ? 'Soon' : 'Paused'}</dd></div>
          </dl>
        </section>
      )}
      <Panel title="Leads in this campaign" className="mt-6" bodyClass="overflow-x-auto">
        <div className="px-5 pb-4">
          <OutcomeBar counts={oc} />
          <div className="flex flex-wrap gap-2 mt-3" role="tablist" aria-label="Filter by result">
            <button role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')} className={cx('h-8 px-3 rounded-full border text-[13px] font-semibold', filter === 'all' ? 'bg-ink text-paper border-ink' : 'bg-surface border-line')}>All <span className="tnum opacity-70">{L.total ?? 0}</span></button>
            {OUTCOME_ORDER.filter((k) => oc[k]).map((k) => (
              <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cx('h-8 px-3 rounded-full border text-[13px] font-semibold inline-flex items-center gap-1.5', filter === k ? 'bg-ink text-paper border-ink' : 'bg-surface border-line')}>
                <span className={cx('h-2 w-2 rounded-full', OUTCOMES[k].dot)} />{OUTCOMES[k].label} <span className="tnum opacity-70">{oc[k]}</span>
              </button>
            ))}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead><tr><th className="th">Lead</th><th className="th">Fit</th><th className="th">What they want</th><th className="th">Campaign status</th><th className="th text-right">Attempts</th><th className="th">Last result</th><th className="th">Next attempt</th><th className="th" /></tr></thead>
          <tbody>{leads.map((x: any) => (
            <tr key={x._id}>
              <td className="td"><Link to={`/leads/${x.leadId?._id}`} className="font-semibold hover:underline">{x.leadId?.companyName ?? 'Deleted'}</Link><p className="text-xs text-muted">{x.leadId?.contactName} · {x.leadId?.phoneMasked}</p></td>
              <td className="td">{x.leadId && <TempPill t={x.leadId.temperature} />}</td>
              <td className="td min-w-[180px]"><OutcomeBadge o={x.leadId?.outcome} />{x.leadId?.followUpAt && ['callback', 'nurture', 'meeting'].includes(x.leadId?.outcome) && <p className="text-xs text-muted mt-1">{localTime(x.leadId.followUpAt)}</p>}</td>
              <td className="td"><Pill tone={CL_TONE[x.status]}>{CL_LABEL[x.status]}</Pill>{x.skipReason && <p className="text-xs text-muted mt-1 max-w-[220px]">{x.skipReason}</p>}</td>
              <td className="td text-right tnum">{x.attempts}</td>
              <td className="td">{x.lastCallId ? <Link to={`/calls/${x.lastCallId}`} className="capitalize hover:underline">{x.lastResult}</Link> : '—'}</td>
              <td className="td text-muted whitespace-nowrap">{['queued', 'retry'].includes(x.status) ? fmtDateTime(x.nextAttemptAt) : '—'}</td>
              <td className="td text-right whitespace-nowrap">{x.leadId?.outcome && !['none', 'no_answer', 'busy'].includes(x.leadId.outcome) && <button className="btn-secondary btn-sm mr-1" onClick={() => setBriefId(x.leadId._id)}>Meeting brief</button>}{can && ['queued', 'retry'].includes(x.status) && <button className="btn-ghost h-8 w-8 p-0" aria-label="Remove from campaign" title="Remove from campaign" onClick={async () => { await del(`/campaigns/${c._id}/leads/${x.leadId._id}`); reload(); }}><UserMinus className="h-4 w-4" /></button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
      <Modal open={!!edit} onClose={() => setEdit(null)} dirty={!!edit} wide title="Edit campaign" footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn-primary" onClick={async () => { try { const { name, description, objective, script, autoCalling, schedule, maxRetries, retryDelayMinutes, dailyLimit, maxConcurrent } = edit; await patch(`/campaigns/${c._id}`, { name, description, objective, script, autoCalling, schedule: { timezone: schedule.timezone, days: schedule.days, startTime: schedule.startTime, endTime: schedule.endTime }, maxRetries, retryDelayMinutes, dailyLimit, maxConcurrent, agentId: edit.agentId?._id ?? edit.agentId, endDate: edit.endDate ? new Date(String(edit.endDate).slice(0, 10) + 'T23:59:59').toISOString() : null, research: edit.research ? { enabled: !!edit.research.enabled, keywords: edit.research.keywords ?? [], locations: finalLocations({ locations: edit.research.locations ?? [], countries: edit.research.countries ?? [] }), countries: edit.research.countries ?? [], frequency: edit.research.frequency ?? 'daily', leadsPerRun: edit.research.leadsPerRun ?? 25, autoApproveMinScore: edit.research.autoApproveMinScore ?? 60 } : undefined }); setEdit(null); reload(); toast.success('Campaign updated'); } catch (e: any) { toast.error(e.message); } }}>Save changes</button></>}>
        {edit && <div className="mb-6"><ResearchFields v={{ ...edit, endDate: edit.endDate ? String(edit.endDate).slice(0, 10) : '', research: { enabled: false, keywords: [], locations: [], countries: [], frequency: 'daily', leadsPerRun: 25, autoApproveMinScore: 60, ...(edit.research ?? {}) } }} set={setEdit} /></div>}
        {edit && agents.data && <CampaignFields v={{ ...edit, agentId: edit.agentId?._id ?? edit.agentId, objective: edit.objective ?? '', script: edit.script ?? '', description: edit.description ?? '' }} set={setEdit} agents={agents.data.agents} />}
      </Modal>
      <Confirm open={confirm === 'complete'} onClose={() => setConfirm(null)} title="Finish this campaign?" confirmLabel="Finish campaign" message="Leads still waiting won’t be called. Calls already in progress will finish." onConfirm={() => act('complete')} />
      <Confirm open={confirm === 'delete'} onClose={() => setConfirm(null)} danger title="Delete this campaign?" confirmLabel="Delete campaign" message="Call records and recordings are kept; the campaign and its lead list are removed." onConfirm={async () => { await del(`/campaigns/${c._id}`); nav('/campaigns'); }} />
      <BriefDrawer leadId={briefId} onClose={() => setBriefId(null)} />
    </>
  );
}

/** Read-only: how the agent decided to pitch this campaign's category. Nothing to configure. */
function PitchCard({ p, agent, category }: { p: any; agent: string; category?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel mt-6">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 p-5 text-left">
        <span className="h-10 w-10 rounded-control bg-sunken text-ink flex items-center justify-center shrink-0"><MessageSquareQuote className="h-5 w-5" /></span>
        <span className="flex-1 min-w-0">
          <span className="font-semibold block">How {agent} pitches {category ? category.toLowerCase() : 'this campaign'}</span>
          <span className="text-[13px] text-muted block truncate">“The reason I’m calling — {p.reason}.”</span>
        </span>
        <ChevronDown className={cx('h-4 w-4 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-5 pb-5 grid gap-5 md:grid-cols-2 text-[13px] border-t border-line pt-4">
          <div>
            <p className="text-muted mb-1">Opening line</p>
            <p className="leading-relaxed">“{p.opener}”</p>
          </div>
          <div>
            <p className="text-muted mb-1">Problems it offers to fix</p>
            <ul className="space-y-1.5">{p.pains.map((x: any) => <li key={x.pain} className="rounded-control bg-sunken px-3 py-2"><span className="font-semibold">{x.pain}</span>{x.offer && <span className="text-muted"> → {x.offer}</span>}</li>)}</ul>
          </div>
          <p className="md:col-span-2 text-xs text-muted">{p.tailored ? 'Tailored to this category by the AI.' : 'Worked out from the campaign category and your products.'} The agent then asks how often the problem happens, pitches the one product that fixes it{p.proof?.length ? ', quotes a real result from your business description' : ''}, and offers a free 15-minute Google Meet. It adapts to whatever the person says.</p>
        </div>
      )}
    </section>
  );
}
