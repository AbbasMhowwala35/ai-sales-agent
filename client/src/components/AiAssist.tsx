import { useState } from 'react';
import { Sparkles, Check, RotateCcw, X } from 'lucide-react';
import { post } from '../lib/api';
import { toast } from '../store/ui';
import { Spinner, cx } from './ui';

export type AssistField = 'description' | 'product' | 'audience' | 'requirements' | 'goals' | 'faq_answer' | 'script' | 'objective' | 'instructions' | 'opening_line' | 'objection_response' | 'note' | 'generic';

/**
 * “Rewrite with AI” for any text field: suggests a natural, human version (or a first draft when empty).
 * Never overwrites silently — the user sees the suggestion and chooses Use this / Try again / Keep mine.
 */
export function AiAssist({ field, value, onApply, context, disabled, className }: { field: AssistField; value: string; onApply: (text: string) => void; context?: string; disabled?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<{ text: string; engine: string } | null>(null);
  const empty = !value?.trim();
  const run = async () => {
    setBusy(true);
    try { setSuggestion(await post('/assist/write', { field, text: value ?? '', context })); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  if (disabled) return null;
  return (
    <div className={cx('mt-1.5', className)}>
      {!suggestion && (
        <button type="button" onClick={run} disabled={busy} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-signal hover:text-signal-ink disabled:opacity-60">
          {busy ? <Spinner className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}{empty ? 'Write it for me' : 'Rewrite with AI'}
        </button>
      )}
      {suggestion && (
        <div className="rounded-control border border-signal/40 bg-signal-soft/40 p-3" role="group" aria-label="AI suggestion">
          <p className="text-[11px] font-semibold text-signal-ink mb-1 flex items-center gap-1"><Sparkles className="h-3 w-3" />Suggestion</p>
          <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{suggestion.text}</p>
          {suggestion.engine === 'basic' && <p className="text-[11px] text-muted mt-1.5">Basic rewrite: tidied the wording and swapped jargon for plain words. Add an OpenAI key with credits on the server for a full AI rewrite.</p>}
          <div className="flex flex-wrap gap-2 mt-2.5">
            <button type="button" className="btn-primary btn-sm" onClick={() => { onApply(suggestion.text); setSuggestion(null); }}><Check className="h-3.5 w-3.5" />Use this</button>
            <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={run}>{busy ? <Spinner className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}Try again</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setSuggestion(null)}><X className="h-3.5 w-3.5" />Keep mine</button>
          </div>
        </div>
      )}
    </div>
  );
}
