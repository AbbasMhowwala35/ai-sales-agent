import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Megaphone, Play, Pause, Check, CircleAlert, Radar, Users } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { post } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { PageHeader, Panel, Pill, STATUS_TONE, Spinner, Modal, Empty, ErrorState, TableSkeleton } from '../components/ui';
import { CampaignFields, LeadPicker, ResearchFields, blankCampaign, countryIso, finalLocations, areaSummary } from '../components/CampaignForm';
import { OutcomeBar } from '../components/Outcome';
import { cx, Field } from '../components/ui';
import { timeAgo } from '../lib/format';

export default function Campaigns() {
  const can = useAuth((s) => s.can('campaigns:write'));
  const [params, setParams] = useSearchParams();
  const { data, error, reload } = useApi<any>('/campaigns', { poll: 8000 });
  const creating = params.get('new') === '1';
  const act = async (id: string, a: string) => { try { await post(`/campaigns/${id}/${a}`); toast.success(a === 'pause' ? 'Campaign paused — no new calls will start' : 'Campaign is live'); reload(); } catch (e: any) { toast.error(e.message); } };
  return (
    <>
      <PageHeader title="Campaigns" description="Choose leads, an agent and a schedule. The agent calls within your hours and limits, retries missed calls and stops for opt-outs."
        actions={can && <button className="btn-primary" onClick={() => setParams({ new: '1' })}><Plus className="h-4 w-4" />New campaign</button>} />
      {error && <ErrorState message={error} onRetry={reload} />}
      <Panel bodyClass="overflow-x-auto">
        {!data ? <TableSkeleton /> : !data.items.length ? <Empty icon={<Megaphone className="h-7 w-7" />} title="No campaigns yet" action={can && <button className="btn-primary" onClick={() => setParams({ new: '1' })}>Create a campaign</button>}>A campaign tells your agent who to call, when, and what to aim for.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Campaign</th><th className="th">Status</th><th className="th">Results so far</th><th className="th text-right">Meetings</th><th className="th text-right">Calls</th><th className="th">Progress</th><th className="th" /></tr></thead>
            <tbody>{data.items.map((c: any) => {
              const total = c.stats?.leads?.total ?? 0; const done = (c.stats?.leads?.completed ?? 0) + (c.stats?.leads?.exhausted ?? 0) + (c.stats?.leads?.skipped ?? 0);
              return (
                <tr key={c._id} className="hover:bg-sunken/50">
                  <td className="td"><Link to={`/campaigns/${c._id}`} className="font-semibold hover:underline">{c.name}</Link>{c.category && <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-muted">{c.category}</span>}
                    <p className="text-xs text-muted truncate max-w-[300px] flex items-center gap-1">{c.research?.enabled && <Radar className="h-3 w-3 text-signal shrink-0" />}{c.research?.enabled ? `Finds ${c.research.keywords?.join(', ')} ${c.research.frequency}` : c.objective}{c.endDate ? ` · until ${new Date(c.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</p></td>
                  <td className="td"><Pill tone={STATUS_TONE[c.status]}>{c.status === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-signal live-dot" />}{c.status}</Pill>{c.status === 'active' && !c.autoCalling && <p className="text-xs text-muted mt-1">Auto-calling off</p>}</td>
                  <td className="td min-w-[220px]"><OutcomeBar counts={c.stats?.outcomes ?? {}} showLegend /></td>
                  <td className="td text-right tnum font-display text-lg font-[650] text-signal">{c.stats?.outcomes?.meeting ?? 0}</td>
                  <td className="td text-right tnum">{c.stats?.calls?.total ?? 0}</td>
                  <td className="td min-w-[140px]"><div className="flex items-center gap-2"><div className="h-1.5 flex-1 rounded-full bg-sunken overflow-hidden"><div className="h-full bg-signal" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div><span className="text-xs tnum text-muted">{done}/{total}</span></div></td>
                  <td className="td text-right whitespace-nowrap">{can && (c.status === 'active' ? <button className="btn-secondary btn-sm" onClick={() => act(c._id, 'pause')}><Pause className="h-4 w-4" />Pause</button> : ['draft', 'paused'].includes(c.status) ? <button className="btn-secondary btn-sm" onClick={() => act(c._id, c.status === 'draft' ? 'start' : 'resume')}><Play className="h-4 w-4" />{c.status === 'draft' ? 'Start' : 'Resume'}</button> : null)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Panel>
      <CreateCampaign open={creating} onClose={() => setParams({})} />
    </>
  );
}

const STEPS = ['Who to call', 'How to call', 'Review & launch'];

function CreateCampaign({ open, onClose }: { open: boolean; onClose: () => void }) {
  const agents = useApi<any>(open ? '/agents' : null);
  const biz = useApi<any>(open ? '/business' : null);
  const [v, setV] = useState<any>(structuredClone(blankCampaign));
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const nav = useNavigate();
  useEffect(() => { if (open) { setStep(0); setSel(new Set()); setShowPicker(false); setV(structuredClone(blankCampaign)); } }, [open]);
  useEffect(() => { if (agents.data && !v.agentId) setV((x: any) => ({ ...x, agentId: agents.data.agents.find((a: any) => a.isDefault)?._id ?? agents.data.agents[0]?._id })); }, [agents.data, v.agentId]);
  const cats = useApi<any>(open ? '/leads/categories' : null).data?.categories ?? [];
  const r = v.research;
  const missingIds = r.enabled ? r.countries.filter((c: string) => !(biz.data?.callerIds ?? []).some((x: any) => x.country === countryIso(c) || (countryIso(c) === 'CA' && x.country === 'US'))) : [];
  const canNext = step === 0 ? v.name.trim() && v.category?.trim() && (!r.enabled || (r.keywords.length && (r.locations.length || r.countries.length))) : step === 1 ? v.agentId && v.schedule.days.length : true;
  const dirty = !!(v.name.trim() || v.category?.trim() || r.keywords.length || r.locations.length || sel.size);
  const create = async (start: boolean) => {
    setBusy(true);
    try {
      const body: any = { ...v, leadIds: [...sel], endDate: v.endDate ? new Date(v.endDate + 'T23:59:59').toISOString() : undefined,
        research: { ...r, locations: finalLocations(r) } };
      if (!body.objective) delete body.objective; if (!body.script) delete body.script; if (!body.description) delete body.description;
      const c = await post('/campaigns', body);
      if (start) await post(`/campaigns/${c._id}/start`);
      toast.success(start ? (r.enabled ? 'Campaign live — your agent is researching prospects now' : `Campaign started with ${c.added} leads`) : 'Campaign saved as draft');
      onClose(); nav(`/campaigns/${c._id}`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const agent = agents.data?.agents?.find((a: any) => a._id === v.agentId);
  return (
    <Modal open={open} onClose={onClose} wide title="New campaign" dirty={dirty} footer={<>
      {step > 0 && <button className="btn-ghost mr-auto" onClick={() => setStep(step - 1)}>Back</button>}
      {step === 0 && !canNext && <span className="text-xs text-muted mr-auto">{!v.name.trim() ? 'Name your campaign to continue' : !v.category?.trim() ? 'Choose who this campaign is for (category)' : 'Add a kind of business and a country or city'}</span>}
      {step < 2 ? <button className="btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</button> : <>
        <button className="btn-secondary" disabled={busy} onClick={() => create(false)}>Save as draft</button>
        <button className="btn-primary" disabled={busy || (!r.enabled && !sel.size)} onClick={() => create(true)}>{busy && <Spinner />}Launch campaign</button>
      </>}
    </>}>
      <ol className="flex items-center gap-2 mb-6" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2 flex-1 min-w-0">
            <span className={cx('h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 tnum', i < step ? 'bg-signal text-white' : i === step ? 'bg-ink text-paper' : 'bg-sunken text-muted')}>{i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
            <span className={cx('text-[13px] truncate hidden sm:block', i === step ? 'font-semibold' : 'text-muted')}>{s}</span>
            {i < STEPS.length - 1 && <span className="flex-1 h-px bg-line hidden sm:block" />}
          </li>
        ))}
      </ol>
      {step === 0 && <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Campaign name"><input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Dentists in Texas — Q4" /></Field>
          <Field label="Who is it for? (category)" hint="Leads found by this campaign are filed under this category.">
            <input className="input" list="campaign-categories" value={v.category ?? ''} onChange={(e) => setV({ ...v, category: e.target.value, research: { ...r, keywords: r.keywords.length || !e.target.value ? r.keywords : r.keywords } })} placeholder="e.g. Dentists, Restaurants, Gyms" />
            <datalist id="campaign-categories">{cats.filter((c: any) => c.key !== '__none').map((c: any) => <option key={c.key} value={c.name} />)}</datalist>
          </Field>
        </div>
        <ResearchFields v={v} set={setV} />
      </div>}
      {step === 1 && (agents.data ? <CampaignFields v={v} set={setV} agents={agents.data.agents} /> : <Spinner />)}
      {step === 2 && <div className="space-y-4">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-[14px]">
          <div><dt className="text-muted text-[13px]">Campaign</dt><dd className="font-semibold">{v.name}</dd></div>
          <div><dt className="text-muted text-[13px]">Sales agent</dt><dd className="font-semibold">{agent?.name} · {agent?.title ?? 'Account Executive'}</dd></div>
          <div><dt className="text-muted text-[13px]">Finds new prospects</dt><dd className="font-semibold">{r.enabled ? `${r.leadsPerRun} ${r.keywords.join(', ')} ${r.frequency} in ${areaSummary(r)}` : 'No — existing leads only'}</dd></div>
          <div><dt className="text-muted text-[13px]">Runs until</dt><dd className="font-semibold">{v.endDate ? new Date(v.endDate).toDateString() : 'You stop it'}</dd></div>
          <div><dt className="text-muted text-[13px]">Calls</dt><dd className="font-semibold">{v.schedule.startTime}–{v.schedule.endTime} their local time · up to {v.dailyLimit}/day</dd></div>
          </dl>
        <section className="rounded-control border border-line p-4">
          <div className="flex items-start gap-3 flex-wrap">
            <Users className="h-5 w-5 text-muted mt-0.5 shrink-0" />
            <div className="flex-1 min-w-[200px]">
              <h3 className="font-semibold text-[14px]">Leads you already have {r.enabled && <span className="text-muted font-normal">· optional</span>}</h3>
              <p className="text-[13px] text-muted">{r.enabled ? (sel.size ? <><b className="text-ink tnum">{sel.size}</b> existing leads will be called too, alongside the new prospects your agent finds.</> : 'Your agent finds new prospects for this campaign. You can also add leads you already have.') : 'This campaign doesn’t search for new prospects, so choose who to call.'}</p>
            </div>
            {r.enabled && <button type="button" className="btn-secondary btn-sm" aria-expanded={showPicker} onClick={() => setShowPicker(!showPicker)}>{showPicker ? 'Hide list' : sel.size ? `Change (${sel.size})` : 'Add existing leads'}</button>}
          </div>
          {(showPicker || !r.enabled) && <div className="mt-4"><LeadPicker selected={sel} onChange={setSel} category={v.category} /></div>}
        </section>
        {missingIds.length > 0 && <div className="rounded-control bg-hot/10 p-3 text-[13px] flex gap-2"><CircleAlert className="h-4 w-4 text-hot shrink-0 mt-0.5" /><p>No local caller ID yet for <b>{missingIds.join(', ')}</b>. Real calls to those countries will wait until you <Link className="underline font-semibold" to="/settings?tab=compliance" onClick={onClose}>add a number</Link>. (Simulated calls work now.)</p></div>}
      </div>}
    </Modal>
  );
}
