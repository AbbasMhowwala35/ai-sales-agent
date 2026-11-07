import { Link } from 'react-router-dom';
import { Check, PhoneCall, CalendarCheck, UserCheck, Clock3, ArrowUpRight, Radio } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { useAuth } from '../store/auth';
import { PageHeader, Panel, Pill, RESULT_TONE, ErrorState, Skeleton, Empty, cx } from '../components/ui';
import { Stat, StatRow } from '../components/Stat';
import { ActivityChart } from '../components/charts';
import { OutcomeBadge, OUTCOMES, OUTCOME_ORDER, PdfButton, localTime } from '../components/Outcome';
import { fmtDuration, fmtNum, timeAgo } from '../lib/format';

function SetupChecklist() {
  const biz = useApi<any>('/business');
  const kb = useApi<any>('/knowledge');
  const leads = useApi<any>('/leads?limit=1');
  const camps = useApi<any>('/campaigns');
  if (!biz.data || !kb.data || !leads.data || !camps.data) return null;
  const b = biz.data;
  const steps = [
    { done: !!b.description && (b.products?.length || b.services?.length), label: 'Tell your agent what you sell', to: '/settings' },
    { done: !!(b.icp?.industries?.length || b.icp?.keywords?.length) && !!b.targetLocations?.length, label: 'Describe your ideal customer', to: '/settings?tab=icp' },
    { done: !!b.callerIds?.length, label: 'Add local caller IDs (+1, +44…)', to: '/settings?tab=compliance' },
    { done: kb.data.documents.some((d: any) => !d.system && d.status === 'ready') || b.faqs?.length > 0, label: 'Train it with docs, website or FAQs', to: '/knowledge' },
    { done: camps.data.items.some((c: any) => c.status !== 'draft'), label: 'Launch your first campaign', to: '/campaigns?new=1' },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (!left) return null;
  return (
    <Panel title="Finish setting up" actions={<span className="text-[13px] text-muted tnum">{steps.length - left} of {steps.length} done</span>} className="mb-6">
      <div className="h-1.5 rounded-full bg-sunken mb-4 overflow-hidden"><div className="h-full bg-signal rounded-full" style={{ width: `${((steps.length - left) / steps.length) * 100}%` }} /></div>
      <ol className="grid gap-1 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((s, i) => (
          <li key={i}>
            <Link to={s.to} className={cx('flex items-start gap-3 rounded-control p-3 h-full hover:bg-sunken', s.done && 'opacity-55')}>
              <span className={cx('h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold tnum', s.done ? 'bg-signal text-white' : 'border-2 border-line text-muted')}>{s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
              <span className={cx('text-[13px] leading-snug', s.done ? 'line-through' : 'font-medium')}>{s.label}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function TodoCard({ to, icon: Icon, count, title, hint, tone }: { to: string; icon: any; count?: number; title: string; hint: string; tone: string }) {
  return (
    <Link to={to} className="group panel p-4 flex flex-col gap-3 hover:border-ink/30 transition-colors">
      <div className="flex items-center justify-between">
        <span className={cx('h-9 w-9 rounded-control flex items-center justify-center', tone)}><Icon className="h-[18px] w-[18px]" /></span>
        <ArrowUpRight className="h-4 w-4 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div>
        <p className="font-display text-[30px] leading-none font-[650] tnum">{count ?? 0}</p>
        <p className="font-semibold mt-1.5">{title}</p>
        <p className="text-[13px] text-muted leading-snug mt-0.5">{hint}</p>
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const user = useAuth((s) => s.user);
  const a = useApi<any>('/analytics');
  const outcomes = useApi<any>('/leads/outcomes', { poll: 20000 });
  const pending = useApi<any>('/leads?approval=pending&limit=1');
  const appts = useApi<any>('/calls/appointments');
  const followUps = useApi<any>('/leads?outcome=callback,nurture,meeting&sort=followUpAt&upcoming=true&limit=6');
  const calls = useApi<any>('/calls?limit=6', { poll: 10000 });
  const camps = useApi<any>('/campaigns', { poll: 15000 });
  const s = a.data?.summary;
  const oc = outcomes.data?.counts ?? {};
  const live = calls.data?.items?.filter((c: any) => c.status !== 'ended').length ?? 0;
  const active = camps.data?.items?.filter((c: any) => c.status === 'active') ?? [];
  const hour = new Date().getHours();
  const meetingsUpcoming = appts.data?.items?.filter((x: any) => x.type !== 'callback').length;
  const totalOutcomes = OUTCOME_ORDER.filter((k) => k !== 'none').reduce((t, k) => t + (oc[k] ?? 0), 0);

  return (
    <>
      <PageHeader title={`Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${user?.name?.split(' ')[0] ?? ''}`} description="Here’s what needs you today, and what your agent has been doing."
        actions={<PdfButton path="/reports/analytics.pdf" filename="sales-report.pdf" label="Download report" />} />

      {/* Agent status strip */}
      <div className="rounded-panel bg-nav text-white px-5 py-4 mb-6 flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-3">
          <span className={cx('h-10 w-10 rounded-full flex items-center justify-center', live ? 'bg-[#2BC3B2]/20' : 'bg-white/10')}><Radio className={cx('h-5 w-5', live ? 'text-[#2BC3B2]' : 'text-white/60')} /></span>
          <div>
            <p className="font-display text-[17px] font-[650]">{live ? `${live} call${live > 1 ? 's' : ''} live right now` : active.length ? 'Your agent is on duty' : 'Your agent is idle'}</p>
            <p className="text-[13px] text-white/60">{active.length ? `${active.length} active campaign${active.length > 1 ? 's' : ''}: ${active.slice(0, 2).map((c: any) => c.name).join(', ')}` : 'Start a campaign to put it to work'}</p>
          </div>
        </div>
        <div className="flex gap-8 ml-auto text-[13px]">
          <div><p className="text-white/50">Calls today</p><p className="font-display text-xl font-[650] tnum">{a.data?.daily?.at(-1)?.total ?? 0}</p></div>
          <div><p className="text-white/50">Connected</p><p className="font-display text-xl font-[650] tnum">{a.data?.daily?.at(-1)?.answered ?? 0}</p></div>
          <div><p className="text-white/50">Follow-ups due</p><p className="font-display text-xl font-[650] tnum text-[#2BC3B2]">{outcomes.data?.due ?? 0}</p></div>
        </div>
      </div>

      <SetupChecklist />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <TodoCard to="/leads?outcome=callback" icon={PhoneCall} count={oc.callback} title="Callbacks" hint="Asked to be called back — the agent rings them at their time" tone="bg-hot/12 text-hot" />
        <TodoCard to="/leads?outcome=meeting" icon={CalendarCheck} count={meetingsUpcoming ?? oc.meeting} title="Meetings coming up" hint="Booked by the agent — prep and join" tone="bg-signal-soft text-signal-ink" />
        <TodoCard to="/leads?approval=pending" icon={UserCheck} count={pending.data?.total} title="Leads to approve" hint="Review new prospects before the agent calls them" tone="bg-cold/12 text-cold" />
        <TodoCard to="/leads?outcome=nurture" icon={Clock3} count={oc.nurture} title="Follow up later" hint="Said “not now” — auto-called again on their date" tone="bg-sunken text-ink" />
      </div>

      {a.error ? <ErrorState message={a.error} onRetry={a.reload} /> : !s ? <Skeleton className="h-[104px]" /> : (
        <StatRow cols={6}>
          <Stat label="Leads found" value={fmtNum(s.leadsDiscovered)} sub="last 30 days" />
          <Stat label="Calls made" value={fmtNum(s.callsInitiated)} sub={`${s.connectRate}% picked up`} />
          <Stat label="Conversations" value={fmtNum(s.connected)} sub={`avg ${fmtDuration(s.avgCallDuration)}`} />
          <Stat label="Interested" value={fmtNum(s.interested)} />
          <Stat label="Meetings booked" value={fmtNum(s.meetingsScheduled)} accent />
          <Stat label="Won" value={fmtNum(s.converted)} sub={`${s.conversionRate}% of leads`} />
        </StatRow>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px] mt-6">
        <Panel title="Calling activity" actions={<Link to="/analytics" className="text-[13px] text-signal font-semibold">See analytics</Link>}>
          {a.data ? <ActivityChart data={a.data.daily} /> : <Skeleton className="h-[260px]" />}
        </Panel>
        <Panel title="What prospects told us">
          {!totalOutcomes ? <p className="text-muted text-[13px]">Once your agent has conversations, you’ll see here what each prospect wants.</p> : <>
            <div className="flex h-3 rounded-full overflow-hidden mb-4" aria-hidden>
              {OUTCOME_ORDER.filter((k) => k !== 'none' && oc[k]).map((k) => <span key={k} className={OUTCOMES[k].dot} style={{ width: `${(oc[k] / totalOutcomes) * 100}%` }} />)}
            </div>
            <ul className="space-y-1">
              {OUTCOME_ORDER.filter((k) => k !== 'none').map((k) => (
                <li key={k}><Link to={`/leads?outcome=${k}`} className="flex items-center justify-between rounded-control px-2 py-1.5 hover:bg-sunken text-[13px]">
                  <span className="flex items-center gap-2"><span className={cx('h-2.5 w-2.5 rounded-full', OUTCOMES[k].dot)} />{OUTCOMES[k].label}</span>
                  <span className="tnum font-semibold">{oc[k] ?? 0}</span>
                </Link></li>
              ))}
            </ul>
          </>}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px] mt-6">
        <Panel title="Latest calls" actions={<Link to="/calls" className="text-[13px] text-signal font-semibold">All calls</Link>} bodyClass="pb-2">
          {calls.data && !calls.data.items.length && <Empty icon={<PhoneCall className="h-7 w-7" />} title="No calls yet">Start a campaign and calls will appear here as they happen.</Empty>}
          <ul>
            {calls.data?.items.map((c: any) => (
              <li key={c._id}>
                <Link to={`/calls/${c._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-sunken border-t border-line">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{c.leadId?.companyName ?? 'Deleted lead'}</p>
                    <p className="text-[13px] text-muted truncate">{c.summary ?? (c.status !== 'ended' ? 'In progress…' : c.endReason ?? '—')}</p>
                  </div>
                  {c.status !== 'ended' ? <Pill tone="green"><span className="h-1.5 w-1.5 rounded-full bg-signal live-dot" />Live</Pill> : <Pill tone={RESULT_TONE[c.result]}>{c.result}</Pill>}
                  <span className="text-xs text-muted w-16 text-right">{timeAgo(c.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Coming up" actions={<PdfButton path="/reports/follow-ups.pdf" filename="follow-ups.pdf" label="PDF" className="btn-ghost btn-sm" />}>
          {followUps.data && !followUps.data.items.length && <p className="text-muted text-[13px]">Meetings, callbacks and “try me later” follow-ups will line up here.</p>}
          <ul className="space-y-3.5">
            {followUps.data?.items.filter((l: any) => l.followUpAt).map((l: any) => (
              <li key={l._id}>
                <Link to={`/leads/${l._id}`} className="block group">
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold group-hover:underline truncate">{l.companyName}</span><OutcomeBadge o={l.outcome} /></div>
                  <p className="text-[13px] text-muted mt-0.5">{localTime(l.followUpAt, l.localTz)}{l.location?.city ? ` · ${l.location.city}` : ''}</p>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
