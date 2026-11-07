import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { X, AlertTriangle, CheckCircle2, Info, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useUI } from '../store/ui';

export const cx = clsx;

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin', className ?? 'h-4 w-4')} aria-hidden />;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-[650]">{title}</h1>
        {description && <p className="text-muted mt-1 max-w-[70ch]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx('panel min-w-0', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          {title && <h2 className="text-[15px] font-[650]">{title}</h2>}
          {actions}
        </header>
      )}
      <div className={cx(bodyClass ?? 'px-5 pb-5', !title && !actions && !bodyClass && 'pt-5')}>{children}</div>
    </section>
  );
}

/** A labelled form field. Use `group` for anything holding several controls (chips, buttons, pickers):
 *  a <label> around several controls forwards stray clicks to the first one. */
export function Field({ label, hint, children, error, group }: { label: string; hint?: ReactNode; children: ReactNode; error?: string; group?: boolean }) {
  const foot = error ? <p className="text-xs text-danger mt-1">{error}</p> : hint ? <p className="hint">{hint}</p> : null;
  if (group) return <div role="group" aria-label={label} className="block"><span className="label">{label}</span>{children}{foot}</div>;
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {foot}
    </label>
  );
}

const TEMP = { hot: 'bg-hot/15 text-hot', warm: 'bg-warm/20 text-[#7a6210] dark:text-warm', cold: 'bg-cold/15 text-cold' } as const;
export function TempPill({ t }: { t: 'hot' | 'warm' | 'cold' | string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', TEMP[t as keyof typeof TEMP] ?? 'bg-sunken text-muted')}><span className="h-1.5 w-1.5 rounded-full bg-current" />{t[0]?.toUpperCase() + t.slice(1)}</span>;
}

const TONES: Record<string, string> = {
  green: 'bg-signal-soft text-signal-ink', amber: 'bg-hot/15 text-hot', red: 'bg-danger/12 text-danger', grey: 'bg-sunken text-muted', blue: 'bg-cold/15 text-cold',
};
export function Pill({ tone = 'grey', children, className }: { tone?: keyof typeof TONES | string; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', TONES[tone] ?? TONES.grey, className)}>{children}</span>;
}

export const RESULT_TONE: Record<string, string> = { answered: 'green', missed: 'amber', voicemail: 'amber', busy: 'blue', failed: 'red' };
export const STATUS_TONE: Record<string, string> = { active: 'green', paused: 'amber', draft: 'grey', completed: 'blue', ready: 'green', processing: 'amber', pending: 'grey', failed: 'red', running: 'amber', queued: 'grey', approved: 'green', rejected: 'red' };

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-hot' : score >= 40 ? 'bg-warm' : 'bg-cold';
  return (
    <div className="flex items-center gap-2 min-w-[90px]" title={`Fit score ${score}/100`}>
      <div className="h-1.5 flex-1 rounded-full bg-sunken overflow-hidden"><div className={cx('h-full rounded-full', color)} style={{ width: `${score}%` }} /></div>
      <span className="tnum text-xs font-semibold w-6 text-right">{score}</span>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <h3 className="text-base font-[650]">{title}</h3>
      {children && <p className="text-muted mt-1 max-w-[52ch]">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="panel p-5 flex items-start gap-3 border-danger/40" role="alert">
      <AlertTriangle className="h-5 w-5 text-danger shrink-0" />
      <div className="flex-1"><p className="font-semibold">Couldn’t load this</p><p className="text-muted">{message}</p></div>
      {onRetry && <button className="btn-secondary btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-control bg-sunken', className)} />;
}
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return <div className="p-4 space-y-3">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>;
}

export function Modal({ open, onClose, title, children, footer, wide, dirty }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; dirty?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  // keep latest values in refs so the effects below only run when the modal opens/closes
  const latest = useRef({ onClose, dirty });
  latest.current = { onClose, dirty };
  const requestClose = () => { if (latest.current.dirty) setAsking(true); else latest.current.onClose(); };
  const requestRef = useRef(requestClose);
  requestRef.current = requestClose;
  useEffect(() => {
    if (!open) { setAsking(false); return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestRef.current(); };
    document.addEventListener('keydown', onKey);
    // focus the first field in the body once, on open — never the close button
    const t = setTimeout(() => bodyRef.current?.querySelector<HTMLElement>('input:not([type=hidden]),textarea,select')?.focus(), 0);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-[rgb(10_15_28/0.5)]" onClick={requestClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx('relative bg-surface w-full rounded-t-panel sm:rounded-panel border border-line max-h-[92vh] flex flex-col', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <header className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-lg font-[650]">{title}</h2>
          <button type="button" tabIndex={-1} className="btn-ghost h-8 w-8 p-0" onClick={requestClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </header>
        <div ref={bodyRef} className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-line flex flex-wrap items-center justify-end gap-2">{footer}</footer>}
        {asking && (
          <div className="absolute inset-0 rounded-panel bg-surface/95 flex items-center justify-center p-6" role="alertdialog" aria-label="Discard changes?">
            <div className="max-w-sm text-center">
              <p className="font-display text-lg font-[650]">Discard what you’ve entered?</p>
              <p className="text-muted mt-1">Your changes in “{title}” haven’t been saved.</p>
              <div className="flex justify-center gap-2 mt-4">
                <button type="button" className="btn-secondary" onClick={() => setAsking(false)} autoFocus>Keep editing</button>
                <button type="button" className="btn-danger" onClick={() => { setAsking(false); latest.current.onClose(); }}>Discard</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Confirm({ open, onClose, onConfirm, title, message, confirmLabel, danger }: { open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>; title: string; message: ReactNode; confirmLabel: string; danger?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{busy && <Spinner />}{confirmLabel}</button>
    </>}>
      <p className="text-muted">{message}</p>
    </Modal>
  );
}

export function Toaster() {
  const { toasts, dismiss } = useUI();
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[min(380px,calc(100vw-32px))]" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('panel flex items-start gap-3 px-4 py-3 shadow-lg', t.kind === 'error' && 'border-danger/50')}>
          {t.kind === 'success' ? <CheckCircle2 className="h-5 w-5 text-signal shrink-0" /> : t.kind === 'error' ? <AlertTriangle className="h-5 w-5 text-danger shrink-0" /> : <Info className="h-5 w-5 text-cold shrink-0" />}
          <p className="flex-1 text-sm">{t.message}</p>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-muted hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-line mb-5 overflow-x-auto" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('px-3 py-2 -mb-px border-b-2 text-sm font-semibold whitespace-nowrap', value === t.id ? 'border-signal text-ink' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 tnum text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-muted">
      <span className="tnum">{(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
      <div className="flex gap-1">
        <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
        <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

/** Free-text chips input (enter or comma to add). */
export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean).filter((s) => !value.includes(s));
    if (parts.length) onChange([...value, ...parts]);
    setDraft('');
  };
  return (
    <div className="input h-auto min-h-9 flex flex-wrap items-center gap-1.5 py-1.5" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-xs font-medium">
          {t}<button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button>
        </span>
      ))}
      <input className="flex-1 min-w-[120px] bg-transparent outline-none text-sm" value={draft} placeholder={value.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)} onBlur={() => draft && add(draft)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1)); }} />
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer py-1">
      <span><span className="font-semibold block">{label}</span>{description && <span className="text-muted text-[13px]">{description}</span>}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative shrink-0 h-6 w-10 rounded-full transition-colors', checked ? 'bg-signal' : 'bg-line')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
    </label>
  );
}

export function Avatar({ name, size = 28 }: { name?: string; size?: number }) {
  const n = (name ?? '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  return <span className="inline-flex items-center justify-center rounded-full bg-signal-soft text-signal-ink font-semibold shrink-0" style={{ width: size, height: size, fontSize: size * 0.4 }}>{n}</span>;
}
