import { Check, X, GraduationCap } from 'lucide-react';
import { Panel, cx } from './ui';

const GRADE_TONE: Record<string, string> = { A: 'bg-signal text-white', B: 'bg-signal-soft text-signal-ink', C: 'bg-warm/25 text-[#7a6210] dark:text-warm', D: 'bg-danger/12 text-danger' };

export function ScoreBadge({ s }: { s: any }) {
  return <span title={`Call score ${s.score}/100`} className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold tnum', GRADE_TONE[s.grade] ?? GRADE_TONE.C)}>{s.grade}<span className="font-semibold opacity-80">{s.score}</span></span>;
}

/** How well the agent sold on this call — each step a top rep would take, with a tip for anything missed. */
export function ScorecardPanel({ s }: { s: any }) {
  const missed = (s.checks ?? []).filter((c: any) => !c.passed);
  return (
    <Panel title={<span className="flex items-center gap-2"><GraduationCap className="h-4 w-4 text-signal" />Sales coaching</span>}>
      <div className="flex items-center gap-4 mb-4">
        <span className={cx('h-14 w-14 rounded-full flex items-center justify-center font-display text-2xl font-[700]', GRADE_TONE[s.grade])}>{s.grade}</span>
        <div>
          <p className="font-semibold text-[15px] tnum">{s.score} / 100</p>
          <p className="text-[13px] text-muted">{missed.length ? `${missed.length} thing${missed.length > 1 ? 's' : ''} to improve` : 'Ran the call like a top rep'}</p>
        </div>
      </div>
      <ul className="space-y-2">
        {(s.checks ?? []).map((c: any) => (
          <li key={c.key} className="flex gap-2.5 text-[13px]">
            {c.passed ? <Check className="h-4 w-4 text-signal shrink-0 mt-0.5" aria-label="Done" /> : <X className="h-4 w-4 text-danger shrink-0 mt-0.5" aria-label="Missed" />}
            <span><span className={c.passed ? '' : 'font-semibold'}>{c.label}</span>{c.tip && <span className="block text-muted mt-0.5">{c.tip}</span>}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted mt-4 tnum">Agent talked {s.talkRatio}% of the time · asked {s.agentQuestions} question{s.agentQuestions === 1 ? '' : 's'} · longest turn {s.longestTurnWords} words</p>
    </Panel>
  );
}
