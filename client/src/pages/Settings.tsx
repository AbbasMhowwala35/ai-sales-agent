import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { patch, post, del, qs } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { PageHeader, Panel, Field, Tabs, TagInput, Toggle, Spinner, ErrorState, Skeleton, Pill, Pagination } from '../components/ui';
import { fmtDate } from '../lib/format';

type Tab = 'profile' | 'offer' | 'icp' | 'priorities' | 'faq' | 'qualification' | 'compliance';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'profile';
  const { data, error, reload } = useApi<any>('/business');
  const [b, setB] = useState<any>();
  const [saving, setSaving] = useState(false);
  const canEdit = useAuth((s) => s.can('business:write'));
  useEffect(() => { if (data) setB(structuredClone(data)); }, [data]);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!b) return <Skeleton className="h-96" />;
  const set = (path: string, v: any) => setB((prev: any) => { const n = structuredClone(prev); const ks = path.split('.'); let o = n; ks.slice(0, -1).forEach((k) => (o = o[k] ??= {})); o[ks.at(-1)!] = v; return n; });
  const save = async () => {
    setSaving(true);
    try {
      const { _id, createdAt, updatedAt, __v, businessId, ...body } = b;
      body.products = (body.products ?? []).filter((p: any) => p.name?.trim());
      body.services = (body.services ?? []).filter((p: any) => p.name?.trim());
      body.callerIds = (body.callerIds ?? []).filter((c: any) => c.number?.trim()).map((c: any) => ({ country: c.country, number: c.number, ...(c.vapiPhoneNumberId ? { vapiPhoneNumberId: c.vapiPhoneNumberId } : {}), ...(c.label ? { label: c.label } : {}) }));
      body.faqs = (body.faqs ?? []).filter((f: any) => f.question?.trim() && f.answer?.trim());
      body.salesScripts = (body.salesScripts ?? []).filter((f: any) => f.name?.trim() && f.content?.trim());
      for (const k of Object.keys(body)) if (body[k] === null) delete body[k];
      if (body.icp) for (const k of ['budgetMin', 'budgetMax']) if (body.icp[k] === '' || body.icp[k] === null) delete body.icp[k]; else if (body.icp[k] !== undefined) body.icp[k] = Number(body.icp[k]);
      const saved = await patch('/business', { ...body, onboardingComplete: true });
      setB(saved); toast.success('Business settings saved. Your agent’s knowledge has been updated.');
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };
  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile', label: 'Business profile' }, { id: 'offer', label: 'Products & services' }, { id: 'icp', label: 'Ideal customer' }, { id: 'priorities', label: 'Lead priorities' },
    { id: 'faq', label: 'FAQs & scripts' }, { id: 'qualification', label: 'Lead qualification' }, { id: 'compliance', label: 'Calling & compliance' },
  ];
  const input = (path: string, props: any = {}) => {
    const v = path.split('.').reduce((o, k) => o?.[k], b) ?? '';
    return props.rows ? <textarea className="input" rows={props.rows} value={v} disabled={!canEdit} onChange={(e) => set(path, e.target.value)} placeholder={props.placeholder} />
      : <input className="input" type={props.type ?? 'text'} value={v} disabled={!canEdit} onChange={(e) => set(path, props.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} placeholder={props.placeholder} min={props.min} max={props.max} />;
  };

  return (
    <>
      <PageHeader title="Business settings" description="Everything here trains your AI agent: it’s indexed into the knowledge base and used to find and qualify leads."
        actions={canEdit && tab !== 'compliance' ? <button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner />}Save changes</button> : canEdit ? <button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner />}Save calling rules</button> : <Pill>View only</Pill>} />
      {params.get('welcome') && <div className="panel border-signal/40 bg-signal-soft/50 p-4 mb-5 flex gap-3"><Sparkles className="h-5 w-5 text-signal shrink-0" /><p><span className="font-semibold">Welcome to Dialstack.</span> Start by describing your business and who you sell to — the more detail, the better your agent sounds on calls.</p></div>}
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t })} />

      {tab === 'profile' && (
        <Panel>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Business name">{input('name')}</Field>
            <Field label="Industry">{input('industry', { placeholder: 'e.g. Healthcare software' })}</Field>
            <Field label="Website">{input('website', { placeholder: 'https://' })}</Field>
            <Field label="Location">{input('location', { placeholder: 'City, Country' })}</Field>
            <Field label="Business phone">{input('phone', { placeholder: '+91 …' })}</Field>
            <Field label="Human transfer number" hint="Calls are transferred here when a prospect asks for a person.">{input('transferNumber', { placeholder: '+91 …' })}</Field>
            <div className="md:col-span-2"><Field label="About the business" hint="The first sentence is used as your agent’s elevator pitch.">{input('description', { rows: 4, placeholder: 'What you do, for whom, and why it matters.' })}</Field></div>
            <div className="md:col-span-2"><Field label="Business goals">{input('goals', { rows: 2, placeholder: 'e.g. Book 40 demos per month with clinics in Maharashtra' })}</Field></div>
          </div>
        </Panel>
      )}

      {tab === 'offer' && (
        <div className="grid gap-6 lg:grid-cols-2">
          {(['products', 'services'] as const).map((k) => (
            <Panel key={k} title={k === 'products' ? 'Products' : 'Services'} actions={canEdit && <button className="btn-secondary btn-sm" onClick={() => set(k, [...(b[k] ?? []), { name: '', description: '', price: '' }])}><Plus className="h-4 w-4" />Add</button>}>
              {!b[k]?.length && <p className="text-muted">Nothing added yet.</p>}
              <div className="space-y-4">
                {b[k]?.map((_: any, i: number) => (
                  <div key={i} className="rounded-control border border-line p-3 space-y-2">
                    <div className="flex gap-2">{input(`${k}.${i}.name`, { placeholder: 'Name' })}<div className="w-36">{input(`${k}.${i}.price`, { placeholder: 'Price' })}</div>
                      {canEdit && <button className="btn-ghost h-9 w-9 p-0 shrink-0" aria-label="Remove" onClick={() => set(k, b[k].filter((_: any, j: number) => j !== i))}><Trash2 className="h-4 w-4" /></button>}</div>
                    {input(`${k}.${i}.description`, { rows: 2, placeholder: 'What it is and the problem it solves' })}
                  </div>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {tab === 'icp' && (
        <Panel>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2"><Field label="Target audience">{input('targetAudience', { rows: 2, placeholder: 'e.g. Independent clinics and diagnostic labs with 2–20 doctors' })}</Field></div>
            <Field label="Target industries" hint="Used for discovery and worth 25 points in the fit score."><TagInput value={b.icp?.industries ?? []} onChange={(v) => set('icp.industries', v)} placeholder="Retail, Healthcare…" /></Field>
            <Field label="Decision-maker roles"><TagInput value={b.icp?.roles ?? []} onChange={(v) => set('icp.roles', v)} placeholder="Founder, Operations Head…" /></Field>
            <Field label="Search keywords" hint="What your ideal customers call themselves or need."><TagInput value={b.icp?.keywords ?? []} onChange={(v) => set('icp.keywords', v)} placeholder="dental clinic, crm…" /></Field>
            <Field label="Target locations"><TagInput value={b.targetLocations ?? []} onChange={(v) => set('targetLocations', v)} placeholder="Mumbai, India" /></Field>
            <Field label="Company sizes">
              <div className="flex flex-wrap gap-2">{SIZES.map((s) => { const on = b.icp?.companySizes?.includes(s); return <button key={s} type="button" disabled={!canEdit} onClick={() => set('icp.companySizes', on ? b.icp.companySizes.filter((x: string) => x !== s) : [...(b.icp?.companySizes ?? []), s])} className={`h-8 px-3 rounded-full border text-[13px] font-medium ${on ? 'bg-signal text-white border-signal' : 'border-line bg-surface hover:bg-sunken'}`}>{s}</button>; })}</div>
            </Field>
            <div className="grid grid-cols-[1fr_1fr_90px] gap-2">
              <Field label="Budget from">{input('icp.budgetMin', { type: 'number', min: 0 })}</Field>
              <Field label="Budget to">{input('icp.budgetMax', { type: 'number', min: 0 })}</Field>
              <Field label="Currency">{input('icp.currency')}</Field>
            </div>
            <div className="md:col-span-2"><Field label="Typical requirements">{input('icp.requirements', { rows: 3, placeholder: 'What a good-fit customer usually needs' })}</Field></div>
          </div>
        </Panel>
      )}

      {tab === 'priorities' && <Priorities b={b} set={set} canEdit={canEdit} />}

      {tab === 'faq' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="FAQs" actions={canEdit && <button className="btn-secondary btn-sm" onClick={() => set('faqs', [...(b.faqs ?? []), { question: '', answer: '' }])}><Plus className="h-4 w-4" />Add FAQ</button>}>
            <p className="text-muted text-[13px] mb-3">Your agent answers these questions word-for-word on calls.</p>
            <div className="space-y-3">
              {b.faqs?.map((_: any, i: number) => (
                <div key={i} className="rounded-control border border-line p-3 space-y-2">
                  <div className="flex gap-2">{input(`faqs.${i}.question`, { placeholder: 'Question' })}{canEdit && <button className="btn-ghost h-9 w-9 p-0 shrink-0" aria-label="Remove FAQ" onClick={() => set('faqs', b.faqs.filter((_: any, j: number) => j !== i))}><Trash2 className="h-4 w-4" /></button>}</div>
                  {input(`faqs.${i}.answer`, { rows: 2, placeholder: 'Answer' })}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Sales scripts" actions={canEdit && <button className="btn-secondary btn-sm" onClick={() => set('salesScripts', [...(b.salesScripts ?? []), { name: '', content: '' }])}><Plus className="h-4 w-4" />Add script</button>}>
            <p className="text-muted text-[13px] mb-3">Talking points and pitches the agent can draw from.</p>
            <div className="space-y-3">
              {b.salesScripts?.map((_: any, i: number) => (
                <div key={i} className="rounded-control border border-line p-3 space-y-2">
                  <div className="flex gap-2">{input(`salesScripts.${i}.name`, { placeholder: 'Script name' })}{canEdit && <button className="btn-ghost h-9 w-9 p-0 shrink-0" aria-label="Remove script" onClick={() => set('salesScripts', b.salesScripts.filter((_: any, j: number) => j !== i))}><Trash2 className="h-4 w-4" /></button>}</div>
                  {input(`salesScripts.${i}.content`, { rows: 5 })}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'qualification' && (
        <Panel>
          <div className="grid gap-5 md:grid-cols-3">
            <Field label="Hot lead from score" hint="0–100">{input('qualification.hotThreshold', { type: 'number', min: 1, max: 100 })}</Field>
            <Field label="Warm lead from score">{input('qualification.warmThreshold', { type: 'number', min: 0, max: 99 })}</Field>
            <Field label="Auto-approve from score" hint="0 means every lead needs manual approval before calling.">{input('qualification.autoApproveAbove', { type: 'number', min: 0, max: 100 })}</Field>
            <div className="md:col-span-3"><Toggle checked={b.qualification?.requirePhone ?? true} onChange={(v) => set('qualification.requirePhone', v)} label="Only keep leads with a phone number" description="Leads without a valid number are skipped during discovery." /></div>
            <div className="md:col-span-3"><Field label="Qualification criteria" hint="What makes a lead worth calling — used by the AI when an LLM is configured.">{input('qualification.criteria', { rows: 3 })}</Field></div>
          </div>
          <div className="mt-6 rounded-control bg-sunken p-4 text-[13px]">
            <p className="font-semibold mb-2">How the fit score is calculated</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-muted tnum">
              <span>Industry match · 25</span><span>Need / keyword fit · 20</span><span>Contactability · 20</span><span>Location match · 15</span><span>Decision-maker role · 15</span><span>Company size · 5</span>
            </div>
          </div>
        </Panel>
      )}

      {tab === 'compliance' && <Compliance b={b} set={set} input={input} canEdit={canEdit} />}
    </>
  );
}

function Compliance({ b, set, input, canEdit }: any) {
  const c = b.compliance ?? {};
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Calling hours">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">{input('compliance.callingWindowStart', { type: 'time' })}</Field>
            <Field label="End">{input('compliance.callingWindowEnd', { type: 'time' })}</Field>
          </div>
          <Field label="Timezone">{input('compliance.timezone')}</Field>
          <Field label="Calling days">
            <div className="flex gap-1.5">{DAYS.map((d, i) => { const on = (c.callingDays ?? []).includes(i); return <button type="button" key={d} disabled={!canEdit} onClick={() => set('compliance.callingDays', on ? c.callingDays.filter((x: number) => x !== i) : [...(c.callingDays ?? []), i].sort())} className={`h-9 w-11 rounded-control border text-[13px] font-semibold ${on ? 'bg-signal text-white border-signal' : 'bg-surface border-line'}`} aria-pressed={on}>{d}</button>; })}</div>
          </Field>
          <Field label="Max attempts per lead (rolling 7 days)">{input('compliance.maxAttemptsPerLead', { type: 'number', min: 1, max: 10 })}</Field>
          <p className="text-[13px] text-muted">These hours apply in <b className="text-ink">each prospect’s local time</b> (US prospects are matched to their state’s time zone). Legal limits are always enforced on top: US 08:00–21:00 (TCPA), UK 08:00–21:00, Canada 09:00–21:30, Australia 09:00–20:00 and no Sundays, India 09:00–21:00 (TRAI).</p>
        </div>
      </Panel>
      <Panel title="Recording & disclosure">
        <div className="space-y-4">
          <Toggle checked={c.recordCalls !== false} onChange={(v) => set('compliance.recordCalls', v)} label="Record calls" description="Recordings are stored privately and only playable by authorised roles." />
          <Toggle checked={c.requireConsentForRecording !== false} onChange={(v) => set('compliance.requireConsentForRecording', v)} label="Start recording only after consent" description="With Twilio, recording begins once the prospect agrees to continue." />
          <Field label="Recording notice read at the start of every call">{input('compliance.recordingConsentMessage', { rows: 2 })}</Field>
          <Toggle checked={c.honorRegistryDnc !== false} onChange={(v) => set('compliance.honorRegistryDnc', v)} label="Honour imported DNC registry lists" />
          <p className="text-[13px] text-muted">Every call opens with a one-line note that it’s an AI assistant — required for AI-voice calls in the US (FCC, Feb 2024) and some states, and good practice under UK PECR. Prospects who ask not to be called are added to your Do-Not-Call list automatically and are never dialled again.</p>
        </div>
      </Panel>
      <Panel title="Local caller IDs" className="lg:col-span-2" actions={canEdit && <button className="btn-secondary btn-sm" onClick={() => set('callerIds', [...(b.callerIds ?? []), { country: 'US', number: '' }])}><Plus className="h-4 w-4" />Add number</button>}>
        <p className="text-[13px] text-muted mb-4 max-w-[75ch]">Prospects see a local number: US and Canadian prospects get a call from your +1 number, UK prospects from your +44 number, and so on. Buy the numbers in Twilio (or import them into Vapi) and add them here. Countries without a number aren’t dialled on real calls.</p>
        {!b.callerIds?.length && <p className="text-[13px] rounded-control bg-hot/10 p-3">No local numbers yet — real calls will use the default number from the server settings.</p>}
        <div className="space-y-2">
          {b.callerIds?.map((c: any, i: number) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[200px_1fr_1fr_auto] items-center">
              <select className="input" disabled={!canEdit} value={c.country} onChange={(e) => set(`callerIds.${i}.country`, e.target.value)} aria-label="Country">
                {[['US', '🇺🇸 USA (+1)'], ['CA', '🇨🇦 Canada (+1)'], ['GB', '🇬🇧 United Kingdom (+44)'], ['AU', '🇦🇺 Australia (+61)'], ['AE', '🇦🇪 UAE (+971)'], ['IE', '🇮🇪 Ireland (+353)'], ['SG', '🇸🇬 Singapore (+65)'], ['NZ', '🇳🇿 New Zealand (+64)'], ['IN', '🇮🇳 India (+91)']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {input(`callerIds.${i}.number`, { placeholder: 'Your number, e.g. +1 512 555 0100' })}
              {input(`callerIds.${i}.vapiPhoneNumberId`, { placeholder: 'Vapi phone number ID (if using Vapi)' })}
              {canEdit && <button className="btn-ghost h-9 w-9 p-0" aria-label="Remove number" onClick={() => set('callerIds', b.callerIds.filter((_: any, j: number) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Follow-ups" className="lg:col-span-2">
        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          <Toggle checked={b.followUps?.autoCallBack !== false} onChange={(v) => set('followUps.autoCallBack', v)} label="Call back automatically" description="When a prospect says “call me tomorrow at 4”, the agent calls at 4 PM their time." />
          <Toggle checked={b.followUps?.autoNurture !== false} onChange={(v) => set('followUps.autoNurture', v)} label="Re-call “not now” prospects" description="“Try me in two months” → the agent calls again in two months." />
          <Field label="If they say “later” without a date, wait (days)">{input('followUps.nurtureDefaultDays', { type: 'number', min: 7, max: 365 })}</Field>
          <Field label="Max follow-up calls per day">{input('followUps.dailyLimit', { type: 'number', min: 1, max: 5000 })}</Field>
        </div>
      </Panel>
      <div className="lg:col-span-2"><DncList canEdit={useAuth.getState().can('compliance:write')} /></div>
    </div>
  );
}

function DncList({ canEdit }: { canEdit: boolean }) {
  const [page, setPage] = useState(1);
  const { data, reload } = useApi<any>(`/compliance/dnc${qs({ page })}`);
  const [phones, setPhones] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      const r = await post('/compliance/dnc', { phones: phones.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) });
      toast.success(`${r.added} number${r.added === 1 ? '' : 's'} added to Do-Not-Call${r.invalid.length ? ` · ${r.invalid.length} invalid skipped` : ''}`);
      setPhones(''); reload();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Panel title="Do-Not-Call list" actions={<span className="text-[13px] text-muted tnum">{data?.total ?? 0} numbers</span>} bodyClass="pb-2">
      {canEdit && <div className="px-5 pb-4 flex flex-col sm:flex-row gap-2">
        <textarea className="input flex-1" rows={2} value={phones} onChange={(e) => setPhones(e.target.value)} placeholder="Paste numbers, one per line or comma-separated (include country code)" />
        <button className="btn-secondary sm:self-start" disabled={!phones.trim() || busy} onClick={add}>{busy && <Spinner />}Add numbers</button>
      </div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className="th">Number</th><th className="th">Reason</th><th className="th">Source</th><th className="th">Added</th><th className="th" /></tr></thead>
          <tbody>
            {data?.items?.map((d: any) => (
              <tr key={d._id}>
                <td className="td tnum font-medium">{d.phoneMasked}</td>
                <td className="td"><Pill tone={d.reason === 'opt_out' ? 'red' : 'grey'}>{d.reason === 'opt_out' ? 'Customer opt-out' : d.reason}</Pill></td>
                <td className="td text-muted max-w-[260px] truncate">{d.source}</td>
                <td className="td text-muted">{fmtDate(d.createdAt)}</td>
                <td className="td text-right">{canEdit && d.reason !== 'opt_out' && <button className="btn-ghost btn-sm" onClick={async () => { await del(`/compliance/dnc/${d._id}`); reload(); }}>Remove</button>}</td>
              </tr>
            ))}
            {!data?.items?.length && <tr><td className="td text-muted text-center py-8" colSpan={5}>No numbers yet. Opt-outs from calls land here automatically.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={page} total={data.total} limit={data.limit} onPage={setPage} />}
    </Panel>
  );
}

const SIGNALS: [string, string][] = [
  ['no_website', 'Has no website'], ['weak_website', 'Has a basic / weak website (score under 60)'], ['good_website', 'Has a good website (score 60+)'],
  ['no_online_booking', 'No online booking'], ['has_online_booking', 'Already has online booking'], ['not_mobile_friendly', 'Website not mobile-friendly'],
  ['no_https', 'Website not secure (no HTTPS)'], ['outdated_website', 'Website looks outdated'], ['keyword_present', 'Description mentions…'], ['keyword_absent', 'Description doesn’t mention…'], ['any', 'Everyone else'],
];

function Priorities({ b, set, canEdit }: { b: any; set: (p: string, v: any) => void; canEdit: boolean }) {
  const { data: templates } = useApi<any>('/business/priority-templates');
  const rules: any[] = b.priorityRules ?? [];
  const upd = (i: number, k: string, v: any) => set('priorityRules', rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Panel title="Who needs you most?" actions={canEdit && rules.length < 6 && <button className="btn-secondary btn-sm" onClick={() => set('priorityRules', [...rules, { priority: Math.min(3, rules.length + 1), signal: 'any', label: '' }])}><Plus className="h-4 w-4" />Add rule</button>}>
        <p className="text-[13px] text-muted mb-4 max-w-[70ch]">Every lead the agent finds gets Priority 1, 2 or 3. Rules are checked in order and the first match wins. The agent checks each lead’s website automatically (whether it exists, mobile, security, freshness, online booking), so you can prioritise by need.</p>
        {!rules.length && <p className="rounded-control bg-sunken p-4 text-[13px]">No rules yet. Start from a template on the right.</p>}
        <ol className="space-y-2">
          {rules.map((r, i) => (
            <li key={i} className="grid gap-2 sm:grid-cols-[90px_1fr_1fr_auto] items-center rounded-control border border-line p-2.5">
              <select className="input" disabled={!canEdit} value={r.priority} onChange={(e) => upd(i, 'priority', Number(e.target.value))} aria-label="Priority">{[1, 2, 3].map((p) => <option key={p} value={p}>P{p}</option>)}</select>
              <div className="flex gap-2">
                <select className="input" disabled={!canEdit} value={r.signal} onChange={(e) => upd(i, 'signal', e.target.value)} aria-label="When the lead">{SIGNALS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                {/keyword/.test(r.signal) && <input className="input w-36" disabled={!canEdit} value={r.value ?? ''} onChange={(e) => upd(i, 'value', e.target.value)} placeholder="word" />}
              </div>
              <input className="input" disabled={!canEdit} value={r.label ?? ''} onChange={(e) => upd(i, 'label', e.target.value)} placeholder="Label shown on the lead" />
              {canEdit && <button className="btn-ghost h-9 w-9 p-0" aria-label="Remove rule" onClick={() => set('priorityRules', rules.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted mt-3">Saving re-checks and re-prioritises all your existing leads in the background.</p>
      </Panel>
      <Panel title="Templates">
        <div className="space-y-2">
          {templates && Object.entries(templates).map(([k, t]: any) => (
            <button key={k} disabled={!canEdit} onClick={() => set('priorityRules', t.rules)} className="w-full text-left rounded-control border border-line p-3 hover:bg-sunken">
              <p className="font-semibold text-[13px]">{t.label}</p>
              <ul className="mt-1 space-y-0.5">{t.rules.map((r: any) => <li key={r.priority} className="text-xs text-muted"><b className="text-ink">P{r.priority}</b> {r.label}</li>)}</ul>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

