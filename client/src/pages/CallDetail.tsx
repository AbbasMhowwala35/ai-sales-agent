import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Sparkles, CalendarClock, PhoneOff, Ban, PhoneForwarded, ShieldCheck } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { post } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { Panel, Pill, RESULT_TONE, ErrorState, Skeleton, Spinner, Empty, cx } from '../components/ui';
import { CallPlayer } from '../components/CallPlayer';
import { ScorecardPanel } from '../components/Scorecard';
import { PdfButton, OutcomeBadge } from '../components/Outcome';
import { fmtDateTime, fmtDuration, cap } from '../lib/format';

const INTENT_TONE: Record<string, string> = { high: 'green', medium: 'amber', low: 'grey', none: 'red' };

export default function CallDetail() {
  const { id } = useParams();
  // Refresh only while the call is live or still being analysed; a finished call never changes.
  const [active, setActive] = useState(true);
  const { data: c, error, reload } = useApi<any>(`/calls/${id}`, { poll: active ? 4000 : 0 });
  useEffect(() => { if (c) setActive(c.status !== 'ended' || c.analysisStatus === 'pending'); }, [c]);
  const can = useAuth((s) => s.can('calls:write'));
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!c) return <Skeleton className="h-[520px]" />;
  const live = c.status !== 'ended';
  const q = c.qualification ?? {};
  return (
    <>
      <Link to="/calls" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-3"><ArrowLeft className="h-4 w-4" />Calls</Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[26px] font-[650]"><Link to={`/leads/${c.leadId?._id}`} className="hover:underline">{c.leadId?.companyName ?? 'Deleted lead'}</Link></h1>
            {live ? <Pill tone="green"><span className="h-1.5 w-1.5 rounded-full bg-signal live-dot" />{cap(c.status)}</Pill> : <Pill tone={RESULT_TONE[c.result]}>{c.result}</Pill>}
            {c.provider === 'simulator' && <Pill>Simulated</Pill>}
            {c.leadId?.outcome && c.leadId.outcome !== 'none' && <OutcomeBadge o={c.leadId.outcome} />}
          </div>
          <p className="text-muted mt-1">{[c.leadId?.contactName, c.leadId?.designation].filter(Boolean).join(', ')} · {fmtDateTime(c.createdAt)} · {fmtDuration(c.durationSec)} · {c.agentId?.name ?? 'Agent'}{c.campaignId ? ` · ${c.campaignId.name}` : ''}</p>
        </div>
        {!live && <PdfButton path={`/reports/calls/${c._id}.pdf`} filename={`call-${c.leadId?.companyName ?? c._id}.pdf`} label="PDF" />}
        {live && can && <button className="btn-danger" onClick={async () => { await post(`/calls/${c._id}/hangup`); toast.info('Call ended'); reload(); }}><PhoneOff className="h-4 w-4" />End call</button>}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          {c.transcript?.segments?.length ? <CallPlayer callId={c._id} segments={c.transcript.segments} duration={c.durationSec} recording={c.recording} agentName={c.agentId?.name ?? 'Agent'} />
            : <Panel>{live ? <div className="flex items-center gap-3 py-10 justify-center text-muted"><Spinner />The transcript appears when the call ends.</div> : <Empty title="No conversation">{c.endReason ?? 'The call wasn’t answered.'}</Empty>}</Panel>}
        </div>
        <div className="space-y-6">
          <Panel title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-signal" />AI summary</span>}>
            {c.analysisStatus === 'pending' && !live ? <div className="flex items-center gap-2 text-muted"><Spinner />Analysing the conversation…</div>
              : c.summary ? <p className="leading-relaxed">{c.summary}</p> : <p className="text-muted">{c.endReason ?? 'No summary for this call.'}</p>}
            {c.nextAction && <div className="mt-4 rounded-control bg-signal-soft/60 p-3"><p className="text-xs font-semibold text-signal-ink">Next best action</p><p className="text-[14px] mt-0.5">{c.nextAction}</p></div>}
          </Panel>
          {c.scorecard && <ScorecardPanel s={c.scorecard} />}
          {c.analysisStatus === 'done' && (
            <Panel title="Qualification">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                <div><dt className="text-muted">Buying intent</dt><dd><Pill tone={INTENT_TONE[q.intent]}>{q.intent ?? '—'}</Pill></dd></div>
                <div><dt className="text-muted">Sentiment</dt><dd className="font-semibold capitalize">{c.sentiment?.label ?? '—'} <span className="text-muted font-normal tnum">({c.sentiment?.score ?? 0})</span></dd></div>
                <div><dt className="text-muted">Interested</dt><dd className="font-semibold">{q.interested ? 'Yes' : 'No'}</dd></div>
                <div><dt className="text-muted">Qualification score</dt><dd className="font-semibold tnum">{q.score ?? '—'}</dd></div>
                <div><dt className="text-muted">Budget</dt><dd className="font-semibold">{q.budget ?? '—'}</dd></div>
                <div><dt className="text-muted">Timeline</dt><dd className="font-semibold">{q.timeline ?? '—'}</dd></div>
              </dl>
              {q.requirements?.length > 0 && <><p className="text-[13px] text-muted mt-4 mb-1.5">Requirements mentioned</p><ul className="space-y-1.5">{q.requirements.map((r: string, i: number) => <li key={i} className="text-[13px] rounded-control bg-sunken px-3 py-2">“{r}”</li>)}</ul></>}
              {c.objections?.length > 0 && <><p className="text-[13px] text-muted mt-4 mb-1.5">Objections</p><ul className="space-y-1.5">{c.objections.map((r: string, i: number) => <li key={i} className="text-[13px] rounded-control bg-hot/10 px-3 py-2">“{r}”</li>)}</ul></>}
            </Panel>
          )}
          <Panel title="Outcome">
            <ul className="space-y-2.5 text-[13px]">
              {c.appointmentId && <li className="flex gap-2.5"><CalendarClock className="h-4 w-4 text-signal mt-0.5" /><span><span className="font-semibold capitalize">{c.appointmentId.type}</span> booked for {fmtDateTime(c.appointmentId.startsAt)}</span></li>}
              {c.transferred && <li className="flex gap-2.5"><PhoneForwarded className="h-4 w-4 text-cold mt-0.5" />Transferred to a team member</li>}
              {c.optOut && <li className="flex gap-2.5 text-danger"><Ban className="h-4 w-4 mt-0.5" />Asked not to be called — added to Do-Not-Call</li>}
              <li className={cx('flex gap-2.5', c.recordingConsent === false && 'text-hot')}><ShieldCheck className="h-4 w-4 mt-0.5 text-muted" />AI disclosed at call start · recording consent: {c.recordingConsent === undefined || c.recordingConsent === null ? 'not captured' : c.recordingConsent ? 'given' : 'declined'}</li>
              {c.endReason && <li className="text-muted">Ended: {c.endReason}</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
