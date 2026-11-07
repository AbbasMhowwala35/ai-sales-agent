import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, Lightbulb, MessageSquareQuote, Target, Package, ShieldAlert, ExternalLink } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { OutcomeBadge, PriorityBadge, localTime } from './Outcome';
import { Spinner } from './ui';

/** Meeting prep: everything the AI learned and offered on its calls with this lead. */
export function BriefContent({ lead }: { lead: any }) {
  const b = lead.brief;
  if (!b?.summary) return <p className="text-muted text-[13px]">No conversation yet — a brief appears here after the agent talks to them.</p>;
  const Section = ({ icon: Icon, title, items, tone }: any) => items?.length ? (
    <div>
      <p className="text-[13px] font-semibold flex items-center gap-1.5 mb-1.5"><Icon className={`h-4 w-4 ${tone ?? 'text-muted'}`} />{title}</p>
      <ul className="space-y-1.5">{items.map((x: string, i: number) => <li key={i} className="text-[13px] leading-snug rounded-control bg-sunken px-3 py-2">{x}</li>)}</ul>
    </div>
  ) : null;
  return (
    <div className="space-y-5">
      <p className="text-[15px] leading-relaxed">{b.summary}</p>
      {(b.budget || b.timeline) && <div className="flex gap-6 text-[13px]">{b.budget && <div><p className="text-muted">Budget</p><p className="font-semibold">{b.budget}</p></div>}{b.timeline && <div><p className="text-muted">Timeline</p><p className="font-semibold">{b.timeline}</p></div>}</div>}
      <Section icon={Lightbulb} title="Talking points for your meeting" items={b.talkingPoints} tone="text-signal" />
      <Section icon={Target} title="Their pain points" items={b.pains} tone="text-hot" />
      <Section icon={Package} title="What the AI offered" items={b.offered} />
      <Section icon={MessageSquareQuote} title="In their own words" items={b.quotes?.map((q: string) => `“${q}”`)} />
      <Section icon={ShieldAlert} title="Objections raised" items={b.objections} tone="text-danger" />
      {b.callId && <Link to={`/calls/${b.callId}`} className="btn-secondary w-full"><ExternalLink className="h-4 w-4" />Listen to the call & full transcript</Link>}
    </div>
  );
}

export function BriefDrawer({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const { data } = useApi<any>(leadId ? `/leads/${leadId}` : null);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  if (!leadId) return null;
  const l = data?.lead;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[rgb(10_15_28/0.4)]" onClick={onClose} />
      <aside className="relative w-full max-w-[460px] h-full bg-surface border-l border-line flex flex-col" role="dialog" aria-label="Meeting brief">
        <header className="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
          {l ? <div className="min-w-0">
            <p className="text-[13px] text-muted">Meeting brief</p>
            <h2 className="text-lg font-[650] leading-tight truncate">{l.companyName}</h2>
            <p className="text-[13px] text-muted">{[l.contactName, l.designation].filter(Boolean).join(', ')}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2"><OutcomeBadge o={l.outcome} /><PriorityBadge p={l.priority} reason={l.priorityReason} />{l.followUpAt && <span className="text-xs text-muted">{localTime(l.followUpAt, l.localTz)}</span>}</div>
          </div> : <Spinner />}
          <button className="btn-ghost h-8 w-8 p-0" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{l && <BriefContent lead={l} />}</div>
        {l && <footer className="px-5 py-3 border-t border-line"><Link to={`/leads/${l._id}`} className="text-signal font-semibold text-[13px]">Open full lead profile</Link></footer>}
      </aside>
    </div>
  );
}
