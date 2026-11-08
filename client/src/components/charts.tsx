import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell, Legend } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { useUI } from '../store/ui';

/** What a chart shows when there's nothing to plot yet — a clear message, not empty axes. */
export function ChartEmpty({ height = 180, title = 'No data yet', hint }: { height?: number; title?: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-control border border-dashed border-line" style={{ minHeight: height }}>
      <BarChart3 className="h-6 w-6 text-muted/70 mb-2" aria-hidden />
      <p className="font-semibold text-[14px]">{title}</p>
      {hint && <p className="text-[13px] text-muted mt-1 max-w-[36ch]">{hint}</p>}
    </div>
  );
}
const allZero = (rows: any[], keys: string[]) => !rows?.length || rows.every((r) => keys.every((k) => !Number(r?.[k])));

export function useChartColors() {
  const dark = useUI((s) => s.dark);
  return dark
    ? { signal: '#2BC3B2', hot: '#EC9B4A', warm: '#DEC054', cold: '#8CACD2', danger: '#EC6868', grid: '#28344E', text: '#94A0B8', ink: '#E6EAF2', surface: '#162036' }
    : { signal: '#0B8F82', hot: '#D9822B', warm: '#C9A834', cold: '#6E8FB5', danger: '#C84040', grid: '#E2E6ED', text: '#5C6880', ink: '#16213A', surface: '#FFFFFF' };
}

const tip = (c: ReturnType<typeof useChartColors>) => ({ contentStyle: { background: c.surface, border: `1px solid ${c.grid}`, borderRadius: 8, fontSize: 12, color: c.ink }, labelStyle: { color: c.text } });
const dayLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function ActivityChart({ data, height = 260 }: { data: any[]; height?: number }) {
  const c = useChartColors();
  if (allZero(data, ['total', 'answered', 'interested'])) return <ChartEmpty height={height} title="No calls in this period" hint="Calls will show up here once a campaign starts dialling." />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: c.text, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis allowDecimals={false} tick={{ fill: c.text, fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip {...tip(c)} labelFormatter={dayLabel} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: c.text }} />
        <Area type="monotone" name="Calls" dataKey="total" stroke={c.cold} fill={c.cold} fillOpacity={0.12} strokeWidth={2} />
        <Area type="monotone" name="Connected" dataKey="answered" stroke={c.signal} fill={c.signal} fillOpacity={0.18} strokeWidth={2} />
        <Area type="monotone" name="Interested" dataKey="interested" stroke={c.hot} fill={c.hot} fillOpacity={0.15} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LeadsChart({ data, height = 220 }: { data: any[]; height?: number }) {
  const c = useChartColors();
  if (allZero(data, ['leads'])) return <ChartEmpty height={height} title="No leads found in this period" hint="Run lead discovery or import a CSV to see new leads here." />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: c.text, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis allowDecimals={false} tick={{ fill: c.text, fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip {...tip(c)} labelFormatter={dayLabel} cursor={{ fill: c.grid, opacity: 0.4 }} />
        <Bar name="Leads discovered" dataKey="leads" fill={c.signal} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HBars({ data, colors, height }: { data: { name: string; value: number }[]; colors?: string[]; height?: number }) {
  const c = useChartColors();
  const pal = colors ?? [c.signal, c.hot, c.cold, c.danger, c.warm];
  if (allZero(data, ['value'])) return <ChartEmpty height={120} title="Nothing to show yet" />;
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(120, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={110} tick={{ fill: c.text, fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(s: string) => s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ')} />
        <Tooltip {...tip(c)} cursor={{ fill: c.grid, opacity: 0.4 }} />
        <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]} barSize={18} label={{ position: 'right', fill: c.text, fontSize: 12 }}>
          {data.map((_, i) => <Cell key={i} fill={pal[i % pal.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Pipeline funnel drawn as proportional bars — reads better than a pie for ordered stages. */
export function Funnel({ stages }: { stages: { stage: string; count: number; label: string }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  if (stages.every((s) => !s.count)) return <ChartEmpty height={140} title="Your pipeline is empty" hint="Leads move through these stages as your agent finds, calls and books them." />;
  return (
    <ol className="space-y-2.5">
      {stages.map((s) => (
        <li key={s.stage} className="grid grid-cols-[120px_1fr_40px] items-center gap-3 text-[13px]">
          <span className="text-muted truncate">{s.label}</span>
          <span className="h-5 rounded bg-sunken overflow-hidden"><span className={s.stage === 'lost' ? 'block h-full bg-danger/50' : s.stage === 'converted' ? 'block h-full bg-hot' : 'block h-full bg-signal/80'} style={{ width: `${(s.count / max) * 100}%` }} /></span>
          <span className="tnum font-semibold text-right">{s.count}</span>
        </li>
      ))}
    </ol>
  );
}
