import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Phone, Mail, Globe, MapPin, Check, Ban, PhoneCall, StickyNote, BellRing, CalendarClock, Activity as ActivityIcon, Sparkles, UserRound, ShieldOff } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { post, patch } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { Panel, Pill, TempPill, ScoreBar, Spinner, ErrorState, Skeleton, RESULT_TONE, STATUS_TONE, Field, cx } from '../components/ui';
import { STAGES, STAGE_LABELS, fmtDateTime, fmtDuration, sourceLabel, timeAgo } from '../lib/format';
import { OutcomeBadge, OUTCOMES, OUTCOME_ORDER, PriorityBadge, localTime } from '../components/Outcome';
import { BriefContent } from '../components/BriefDrawer';

function OutcomeCard({ lead: l, onSaved, canWrite }: { lead: any; onSaved: () => void; canWrite: boolean }) {
  const [edit, setEdit] = useState(false);
  const [o, setO] = useState(l.outcome ?? 'none');
  const [note, setNote] = useState(l.outcomeNote ?? '');
  const [at, setAt] = useState(l.followUpAt ? new Date(new Date(l.followUpAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  const d = OUTCOMES[(l.outcome ?? 'none') as keyof typeof OUTCOMES] ?? OUTCOMES.none;
  const save = async () => {
    try { await patch(`/leads/${l._id}`, { outcome: o, outcomeNote: note || undefined, followUpAt: at ? new Date(at).toISOString() : null }); toast.success('Updated'); setEdit(false); onSaved(); }
    catch (e: any) { toast.error(e.message); }
  };
  const auto = ['callback', 'nurture'].includes(l.outcome) && l.followUpAt;
  return (
    <section className={cx('panel mb-6 p-5 border-l-4', d.dot.replace('bg-', 'border-'))} aria-label="What they want">
      {!edit ? (
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-[240px]">
            <p className="text-[13px] text-muted mb-1.5">What they want</p>
            <OutcomeBadge o={l.outcome} size="md" />
            <p className="mt-2 text-[15px]">{l.outcomeNote ?? d.help}</p>
          </div>
          {l.followUpAt && ['callback', 'nurture', 'meeting', 'interested'].includes(l.outcome) && (
            <div className="min-w-[220px]">
              <p className="text-[13px] text-muted mb-1">{l.outcome === 'meeting' ? 'Meeting time' : 'Next contact'}</p>
              <p className="font-display text-lg font-[650]">{localTime(l.followUpAt, l.localTz)}</p>
              <p className="text-xs text-muted">Their local time{auto ? ' · the agent will call automatically' : ''}</p>
            </div>
          )}
          {canWrite && <button className="btn-secondary btn-sm" onClick={() => setEdit(true)}>Change</button>}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[220px_1fr_220px_auto] items-end">
          <Field label="What they want"><select className="input" value={o} onChange={(e) => setO(e.target.value)}>{OUTCOME_ORDER.map((k) => <option key={k} value={k}>{OUTCOMES[k].label}</option>)}</select></Field>
          <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Budget opens in January" /></Field>
          <Field label="Follow up on"><input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
          <div className="flex gap-2"><button className="btn-ghost" onClick={() => setEdit(false)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></div>
        </div>
      )}
    </section>
  );
}

const ACT_ICON: Record<string, any> = { note: StickyNote, call: PhoneCall, reminder: BellRing, appointment: CalendarClock, approval: Check, opt_out: ShieldOff, assignment: UserRound };

export default function LeadDetail() {
  const { id } = useParams();
  const { data, error, reload } = useApi<any>(`/leads/${id}`, { poll: 10000 });
  const team = useApi<any>('/team');
  const { can } = useAuth();
  const [calling, setCalling] = useState(false);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-[480px]" />;
  const l = data.lead;
  const update = async (body: any, msg?: string) => { try { await patch(`/leads/${l._id}`, body); if (msg) toast.success(msg); reload(); } catch (e: any) { toast.error(e.message); } };
  const callNow = async () => {
    setCalling(true);
    try { await post('/calls', { leadId: l._id }); toast.success('Call queued — the agent is dialling'); setTimeout(reload, 1500); }
    catch (e: any) { toast.error(e.message); } finally { setCalling(false); }
  };
  const callable = l.approval === 'approved' && l.phone && !l.doNotCall;
  return (
    <>
      <Link to="/leads" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-3"><ArrowLeft className="h-4 w-4" />Leads</Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-[26px] font-[650] leading-tight">{l.companyName}</h1><TempPill t={l.temperature} />{l.doNotCall && <Pill tone="red"><Ban className="h-3 w-3" />Do not call</Pill>}{l.tags?.includes('sandbox') && <Pill>Sandbox data</Pill>}</div>
          <p className="text-muted mt-1">{[l.contactName, l.designation].filter(Boolean).join(', ') || 'No contact person yet'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('leads:approve') && l.approval !== 'approved' && <button className="btn-secondary" onClick={() => post('/leads/bulk', { ids: [l._id], action: 'approve' }).then(reload)}><Check className="h-4 w-4" />Approve for calling</button>}
          {can('leads:approve') && l.approval !== 'rejected' && <button className="btn-ghost" onClick={() => post('/leads/bulk', { ids: [l._id], action: 'reject' }).then(reload)}>Reject</button>}
          {can('calls:write') && <button className="btn-primary" disabled={!callable || calling} onClick={callNow} title={!callable ? 'Approve the lead and make sure it has a phone number first' : undefined}>{calling ? <Spinner /> : <PhoneCall className="h-4 w-4" />}Call now with AI</button>}
        </div>
      </div>

      <OutcomeCard lead={l} onSaved={reload} canWrite={can('leads:write')} />
      {l.brief?.summary && <Panel title="Meeting brief — what the AI learned" className="mb-6"><BriefContent lead={l} /></Panel>}
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-6">
          <Panel title="Details">
            <ul className="space-y-2.5 text-[14px]">
              {l.phone && <li className="flex gap-2.5"><Phone className="h-4 w-4 text-muted mt-0.5" /><a className="tnum hover:underline" href={`tel:${l.phone}`}>{l.phone}</a></li>}
              {l.email && <li className="flex gap-2.5"><Mail className="h-4 w-4 text-muted mt-0.5" /><a className="hover:underline break-all" href={`mailto:${l.email}`}>{l.email}</a></li>}
              {l.website && <li className="flex gap-2.5"><Globe className="h-4 w-4 text-muted mt-0.5" /><a className="hover:underline break-all" href={l.website} target="_blank" rel="noreferrer noopener">{l.domain ?? l.website}</a></li>}
              {(l.location?.city || l.location?.address) && <li className="flex gap-2.5"><MapPin className="h-4 w-4 text-muted mt-0.5" /><span>{l.location.address ?? [l.location.city, l.location.state, l.location.country].filter(Boolean).join(', ')}</span></li>}
            </ul>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mt-5 text-[13px]">
              <div><dt className="text-muted">Industry</dt><dd className="font-medium">{l.industry ?? '—'}</dd></div>
              <div><dt className="text-muted">Company size</dt><dd className="font-medium">{l.companySize ?? '—'}</dd></div>
              <div><dt className="text-muted">Source</dt><dd className="font-medium">{sourceLabel(l.source)}</dd></div>
              <div><dt className="text-muted">Approval</dt><dd><Pill tone={STATUS_TONE[l.approval]}>{l.approval}</Pill></dd></div>
              <div><dt className="text-muted">Consent</dt><dd className="font-medium capitalize">{l.consent}</dd></div>
              <div><dt className="text-muted">Last contacted</dt><dd className="font-medium">{l.lastContactedAt ? timeAgo(l.lastContactedAt) : 'Never'}</dd></div>
            </dl>
            {l.description && <p className="text-[13px] text-muted mt-4 leading-relaxed">{l.description}</p>}
          </Panel>
          <Panel title="Pipeline">
            <div className="space-y-4">
              <Field label="Stage"><select className="input" disabled={!can('leads:write')} value={l.status} onChange={(e) => update({ status: e.target.value }, `Moved to ${STAGE_LABELS[e.target.value]}`)}>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select></Field>
              <Field label="Owner"><select className="input" disabled={!can('leads:write')} value={l.assignedTo?._id ?? ''} onChange={(e) => update({ assignedTo: e.target.value || null }, 'Owner updated')}><option value="">Unassigned</option>{team.data?.members?.filter((m: any) => m.status === 'active').map((m: any) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></Field>
              {can('leads:write') && !l.doNotCall && <button className="btn-ghost btn-sm text-danger" onClick={() => update({ consent: 'revoked' }, 'Marked as Do-Not-Call')}><Ban className="h-4 w-4" />Mark as do not call</button>}
            </div>
          </Panel>
          <Panel title={<span className="flex items-center gap-2">Priority <PriorityBadge p={l.priority} reason={l.priorityReason} /></span>}>
            <p className="text-[13px]">{l.priorityReason ?? 'No priority rules yet — set them in Business Settings → Lead priorities.'}</p>
            {l.category && <p className="text-xs text-muted mt-1">Category: <b className="text-ink">{l.category}</b></p>}
            {l.websiteAudit?.checkedAt && (
              <div className="mt-4 rounded-control bg-sunken p-3">
                <div className="flex items-center justify-between"><p className="text-[13px] font-semibold">Website check</p>{l.websiteAudit.hasWebsite && l.websiteAudit.reachable ? <span className={cx('tnum font-display text-lg font-[650]', l.websiteAudit.score >= 60 ? 'text-signal' : 'text-hot')}>{l.websiteAudit.score}/100</span> : <Pill tone="amber">No website</Pill>}</div>
                {l.websiteAudit.platform && <p className="text-xs text-muted">Built with {l.websiteAudit.platform}</p>}
                <ul className="mt-2 space-y-1">{l.websiteAudit.issues?.map((x: string) => <li key={x} className="text-xs flex gap-1.5"><span className="text-hot">•</span>{x}</li>)}</ul>
              </div>
            )}
          </Panel>
          <Panel title={<span className="flex items-center gap-2">Fit score <span className="tnum text-muted font-normal">{l.score}/100</span></span>}>
            <ScoreBar score={l.score} />
            <ul className="mt-4 space-y-2.5">
              {l.scoreBreakdown?.map((b: any) => (
                <li key={b.factor} className="flex items-start justify-between gap-3 text-[13px]"><span><span className="font-semibold">{b.factor}</span><span className="block text-muted">{b.reason}</span></span><span className={cx('tnum font-semibold', b.points ? 'text-signal' : 'text-muted')}>+{b.points}</span></li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="space-y-6 min-w-0">
          {data.calls.length > 0 && (
            <Panel title="Calls" bodyClass="pb-2">
              <ul>{data.calls.map((c: any) => (
                <li key={c._id}><Link to={`/calls/${c._id}`} className="flex items-start gap-3 px-5 py-3 border-t border-line hover:bg-sunken">
                  <PhoneCall className="h-4 w-4 mt-1 text-muted" />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">{c.status === 'ended' ? <Pill tone={RESULT_TONE[c.result]}>{c.result}</Pill> : <Pill tone="green">Live</Pill>}<span className="text-[13px] text-muted">{fmtDateTime(c.createdAt)} · {fmtDuration(c.durationSec)}{c.campaignId ? ` · ${c.campaignId.name}` : ''}</span></div>
                    {c.summary && <p className="text-[13px] mt-1 line-clamp-2">{c.summary}</p>}
                    {c.nextAction && <p className="text-xs text-signal-ink mt-1 flex gap-1"><Sparkles className="h-3.5 w-3.5 shrink-0" />{c.nextAction}</p>}
                  </div>
                </Link></li>
              ))}</ul>
            </Panel>
          )}
          {data.appointments.length > 0 && (
            <Panel title="Appointments">
              <ul className="space-y-2">{data.appointments.map((a: any) => (
                <li key={a._id} className="flex items-center justify-between gap-3 rounded-control bg-sunken px-3 py-2.5 text-[13px]">
                  <span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-signal" /><span className="font-semibold capitalize">{a.type}</span>{fmtDateTime(a.startsAt)}</span>
                  <Pill tone={a.status === 'scheduled' ? 'green' : 'grey'}>{a.status}</Pill>
                </li>
              ))}</ul>
            </Panel>
          )}
          <Composer leadId={l._id} reminders={data.reminders} onDone={reload} canWrite={can('leads:write')} />
          <Panel title="Activity">
            <ol className="relative border-l border-line ml-2 space-y-5">
              {data.activities.map((a: any) => { const Icon = ACT_ICON[a.type] ?? ActivityIcon; return (
                <li key={a._id} className="ml-5">
                  <span className={cx('absolute -left-[11px] h-[22px] w-[22px] rounded-full flex items-center justify-center border-2 border-surface', a.type === 'opt_out' ? 'bg-danger/15 text-danger' : a.type === 'note' ? 'bg-warm/20 text-ink' : 'bg-sunken text-muted')}><Icon className="h-3 w-3" /></span>
                  <p className={cx('text-[14px]', a.type === 'note' && 'whitespace-pre-wrap')}>{a.message}</p>
                  <p className="text-xs text-muted mt-0.5">{a.userId?.name ? `${a.userId.name} · ` : a.type === 'call' || a.type === 'appointment' ? 'AI agent · ' : ''}{fmtDateTime(a.createdAt)}</p>
                </li>
              ); })}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Composer({ leadId, reminders, onDone, canWrite }: { leadId: string; reminders: any[]; onDone: () => void; canWrite: boolean }) {
  const [mode, setMode] = useState<'note' | 'reminder'>('note');
  const [text, setText] = useState(''); const [due, setDue] = useState(''); const [busy, setBusy] = useState(false);
  if (!canWrite) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      if (mode === 'note') await post(`/leads/${leadId}/notes`, { text });
      else await post(`/leads/${leadId}/reminders`, { dueAt: new Date(due).toISOString(), note: text || undefined });
      toast.success(mode === 'note' ? 'Note added' : 'Follow-up reminder set'); setText(''); setDue(''); onDone();
    } catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  };
  const open = reminders.filter((r) => !r.done);
  return (
    <Panel>
      <div className="flex gap-1 mb-3">{(['note', 'reminder'] as const).map((m) => <button key={m} type="button" className={cx('btn-sm btn', mode === m ? 'bg-sunken text-ink' : 'text-muted')} onClick={() => setMode(m)}>{m === 'note' ? <><StickyNote className="h-4 w-4" />Note</> : <><BellRing className="h-4 w-4" />Follow-up</>}</button>)}</div>
      <form onSubmit={submit} className="space-y-2">
        <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'note' ? 'Add a note for your team…' : 'What to do (optional)'} aria-label={mode === 'note' ? 'Note' : 'Reminder note'} />
        <div className="flex gap-2 justify-end">
          {mode === 'reminder' && <input type="datetime-local" className="input w-auto" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Remind me at" required />}
          <button className="btn-primary" disabled={busy || (mode === 'note' ? !text.trim() : !due)}>{busy && <Spinner />}{mode === 'note' ? 'Add note' : 'Set reminder'}</button>
        </div>
      </form>
      {open.length > 0 && <ul className="mt-4 space-y-2">{open.map((r) => (
        <li key={r._id} className="flex items-center gap-3 text-[13px]">
          <input type="checkbox" className="accent-[rgb(var(--signal))]" onChange={() => patch(`/leads/${leadId}/reminders/${r._id}`, { done: true }).then(onDone)} aria-label="Mark reminder done" />
          <span className="flex-1">{r.note ?? 'Follow up'}</span><span className={cx('tnum', new Date(r.dueAt) < new Date() ? 'text-danger font-semibold' : 'text-muted')}>{fmtDateTime(r.dueAt)}</span>
        </li>
      ))}</ul>}
    </Panel>
  );
}
