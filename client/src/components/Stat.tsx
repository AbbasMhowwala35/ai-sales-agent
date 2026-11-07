import type { ReactNode } from 'react';
export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className={`font-display text-[28px] leading-tight font-[650] tnum mt-0.5 ${accent ? 'text-signal' : ''}`}>{value}</p>
      {sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}
    </div>
  );
}
/** A row of stats sharing one panel, separated by hairlines — denser and calmer than a card per number. */
export function StatRow({ children, cols = 4 }: { children: ReactNode; cols?: number }) {
  const g = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }[cols] ?? 'lg:grid-cols-4';
  return <div className={`panel grid grid-cols-2 ${g} divide-x divide-y lg:divide-y-0 divide-line overflow-hidden`}>{children}</div>;
}
