import { useMemo, useState } from 'react';
import { useApi } from '../lib/useApi';
import { qs } from '../lib/api';
import { ChevronRight, X } from 'lucide-react';
import { Field, Toggle, TagInput, cx } from './ui';
import { PriorityBadge, OutcomeBadge } from './Outcome';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const blankCampaign = {
  name: '', category: '', description: '', agentId: '', objective: '', script: '', autoCalling: true,
  schedule: { timezone: 'America/New_York', days: [1, 2, 3, 4, 5], startTime: '10:00', endTime: '18:00' },
  maxRetries: 2, retryDelayMinutes: 120, dailyLimit: 100, maxConcurrent: 3, endDate: '',
  research: { enabled: true, provider: 'auto', keywords: [] as string[], industries: [] as string[], locations: [] as string[], countries: [] as string[], roles: [] as string[], frequency: 'daily', leadsPerRun: 25, autoApproveMinScore: 60 },
};
export const COUNTRIES = [
  { name: 'USA', code: '+1', flag: '🇺🇸' }, { name: 'United Kingdom', code: '+44', flag: '🇬🇧' }, { name: 'Canada', code: '+1', flag: '🇨🇦' },
  { name: 'Australia', code: '+61', flag: '🇦🇺' }, { name: 'UAE', code: '+971', flag: '🇦🇪' }, { name: 'Ireland', code: '+353', flag: '🇮🇪' },
  { name: 'Singapore', code: '+65', flag: '🇸🇬' }, { name: 'New Zealand', code: '+64', flag: '🇳🇿' }, { name: 'India', code: '+91', flag: '🇮🇳' },
];
const ISO: Record<string, string> = { USA: 'US', 'United Kingdom': 'GB', Canada: 'CA', Australia: 'AU', UAE: 'AE', Ireland: 'IE', Singapore: 'SG', 'New Zealand': 'NZ', India: 'IN' };
export const countryIso = (n: string) => ISO[n] ?? n;

/** Turn picked areas + countries into the search locations: countries with no specific area are searched whole. */
export function finalLocations(r: { locations: string[]; countries: string[] }) {
  const areas = r.locations.filter((l) => !r.countries.includes(l));
  const covered = new Set(areas.map(areaCountry).filter(Boolean));
  return [...areas, ...r.countries.filter((c) => !covered.has(c))];
}
const areaCountry = (loc: string) => { const p = loc.split(',').map((x) => x.trim()); return p.length > 1 ? COUNTRIES.find((c) => c.name === p[p.length - 1])?.name : undefined; };
/** “Austin, Texas, USA” → “Austin, Texas”; “Texas, USA” → “All of Texas”. */
export function areaLabel(loc: string, geo?: any[]) {
  const p = loc.split(',').map((x) => x.trim());
  if (!areaCountry(loc)) return loc;
  if (p.length === 2) { const g = geo?.find((c) => c.name === p[1]); return g?.regions?.[p[0]] ? `All of ${p[0]}` : p[0]; }
  return p.slice(0, -1).join(', ');
}
export function areaSummary(r: { locations: string[]; countries: string[] }) {
  const locs = finalLocations(r);
  return locs.map((l) => (COUNTRIES.some((c) => c.name === l) ? `all of ${l}` : l.replace(/, (USA|United Kingdom|Canada|Australia|UAE|Ireland|Singapore|New Zealand|India)$/, ''))).join(' · ') || 'anywhere';
}

/** Country → state → city, picked from lists (any other city can be typed). */
export function AreaPicker({ countries, locations, onChange }: { countries: string[]; locations: string[]; onChange: (x: { countries: string[]; locations: string[] }) => void }) {
  const geo = useApi<any>('/lead-generation/geo').data?.countries as any[] | undefined;
  const toggleCountry = (name: string) => countries.includes(name)
    ? onChange({ countries: countries.filter((x) => x !== name), locations: locations.filter((l) => areaCountry(l) !== name && l !== name) })
    : onChange({ countries: [...countries, name], locations });
  const other = locations.filter((l) => !areaCountry(l) && !COUNTRIES.some((c) => c.name === l));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">{COUNTRIES.map((c) => { const on = countries.includes(c.name); return (
        <button type="button" key={c.name} aria-pressed={on} onClick={() => toggleCountry(c.name)}
          className={cx('h-9 px-3 rounded-full border text-[13px] font-medium flex items-center gap-1.5', on ? 'bg-ink text-paper border-ink' : 'bg-surface border-line hover:bg-sunken')}>
          <span aria-hidden>{c.flag}</span>{c.name}<span className={cx('tnum text-xs', on ? 'opacity-70' : 'text-muted')}>{c.code}</span>
        </button>); })}</div>
      {countries.map((name) => <CountryAreas key={name} name={name} geo={geo?.find((g) => g.name === name)} locations={locations} onChange={(locs) => onChange({ countries, locations: locs })} />)}
      {other.length > 0 && <div className="flex flex-wrap gap-1.5 items-center text-[13px]"><span className="text-muted">Other places:</span>{other.map((l) => <AreaChip key={l} label={l} onRemove={() => onChange({ countries, locations: locations.filter((x) => x !== l) })} />)}</div>}
    </div>
  );
}

function AreaChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-signal-soft text-signal-ink pl-2.5 pr-1 py-0.5 text-[12px] font-semibold">{label}
    <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="h-5 w-5 rounded-full hover:bg-signal/20 flex items-center justify-center"><X className="h-3 w-3" /></button></span>;
}

function CountryAreas({ name, geo, locations, onChange }: { name: string; geo?: any; locations: string[]; onChange: (l: string[]) => void }) {
  const [region, setRegion] = useState('');
  const [typed, setTyped] = useState('');
  const mine = locations.filter((l) => areaCountry(l) === name);
  const flag = COUNTRIES.find((c) => c.name === name)?.flag;
  const regionLabel = geo?.regionLabel ?? 'State';
  const regions = geo ? Object.keys(geo.regions) : [];
  const cityLoc = (city: string, reg = region) => `${city}, ${reg ? `${reg}, ` : ''}${name}`;
  const regionLoc = `${region}, ${name}`;
  const toggle = (loc: string) => onChange(mine.includes(loc) ? locations.filter((x) => x !== loc) : [...locations.filter((x) => x !== name), loc]);
  const addTyped = () => {
    const city = typed.trim(); if (!city) return;
    const reg = region || regions.find((r) => geo.regions[r].some((c: string) => c.toLowerCase() === city.toLowerCase())) || '';
    const loc = cityLoc(city.replace(/,.*$/, ''), reg);
    if (!locations.includes(loc)) onChange([...locations, loc]);
    setTyped('');
  };
  return (
    <div className="rounded-control border border-line p-3 space-y-2.5" data-testid={`areas-${name}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-[13px]"><span aria-hidden>{flag}</span> {name}</span>
        <span className="text-xs text-muted">{mine.length ? `${mine.length} area${mine.length > 1 ? 's' : ''} picked` : `Whole country — or pick a ${regionLabel.toLowerCase()} and cities`}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto min-w-[180px]" aria-label={`${regionLabel} in ${name}`} value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">Choose a {regionLabel.toLowerCase()}…</option>
          {regions.map((r) => <option key={r} value={r}>{r}{mine.some((l) => l.includes(`${r}, `)) ? ' ✓' : ''}</option>)}
        </select>
        <div className="flex flex-1 min-w-[200px] gap-2">
          <input className="input flex-1" aria-label={`Another city in ${name}`} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }} placeholder={region ? `Another city in ${region}` : 'Or type any city'} />
          <button type="button" className="btn-secondary" disabled={!typed.trim()} onClick={addTyped}>Add</button>
        </div>
      </div>
      {region && geo && <div className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={mine.includes(regionLoc)} onClick={() => toggle(regionLoc)} className={cx('h-8 px-3 rounded-full border text-[12px] font-semibold', mine.includes(regionLoc) ? 'bg-signal text-white border-signal' : 'border-line hover:bg-sunken')}>All of {region}</button>
        {geo.regions[region].map((c: string) => { const loc = cityLoc(c); const on = mine.includes(loc); return (
          <button type="button" key={c} aria-pressed={on} onClick={() => toggle(loc)} className={cx('h-8 px-3 rounded-full border text-[12px]', on ? 'bg-signal-soft border-signal text-signal-ink font-semibold' : 'border-line hover:bg-sunken')}>{c}</button>); })}
      </div>}
      {mine.length > 0 && <div className="flex flex-wrap gap-1.5 pt-1 border-t border-line">{mine.map((l) => <AreaChip key={l} label={areaLabel(l, geo ? [geo] : undefined)} onRemove={() => onChange(locations.filter((x) => x !== l))} />)}</div>}
    </div>
  );
}

/** Who to call: automatic prospect research on a cadence until an end date. */
export function ResearchFields({ v, set }: { v: any; set: (v: any) => void }) {
  const r = v.research;
  const setR = (patch: any) => set({ ...v, research: { ...r, ...patch } });
  const presets = [{ l: '1 week', d: 7 }, { l: '1 month', d: 30 }, { l: '3 months', d: 90 }, { l: '1 year', d: 365 }];
  return (
    <div className="space-y-5">
      <Toggle checked={r.enabled} onChange={(x) => setR({ enabled: x })} label="Find new prospects automatically" description={r.enabled ? 'Your agent researches fresh businesses matching this target on a schedule, scores them, and adds the good ones to this campaign.' : 'Off — you’ll choose leads you already have in the last step.'} />
      {r.enabled && <>
        <Field label="What kind of business?" hint="e.g. hair salon, nail salon, med spa"><TagInput value={r.keywords} onChange={(x) => setR({ keywords: x })} placeholder="hair salon" /></Field>
        <Field label="Where?" group hint="Pick a country, then a state and cities. Prospects get a call from your local number in each country.">
          <AreaPicker countries={r.countries} locations={r.locations} onChange={(x) => setR(x)} />
        </Field>
        <Field label="How often should it look for new prospects?" group>
          <div className="grid grid-cols-3 gap-2">{(['daily', 'weekly', 'monthly'] as const).map((f) => (
            <button type="button" key={f} aria-pressed={r.frequency === f} onClick={() => setR({ frequency: f })} className={cx('rounded-control border p-3 text-left', r.frequency === f ? 'border-signal bg-signal-soft/60' : 'border-line hover:bg-sunken')}>
              <span className="font-semibold capitalize block">{f}</span><span className="text-xs text-muted">{f === 'daily' ? 'Every day' : f === 'weekly' ? 'Once a week' : 'Once a month'}</span>
            </button>))}</div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`New prospects per search · ${r.leadsPerRun}`}><input type="range" min={5} max={100} step={5} value={r.leadsPerRun} onChange={(e) => setR({ leadsPerRun: Number(e.target.value) })} className="w-full accent-[rgb(var(--signal))]" /></Field>
          <Field label={`Auto-approve when fit score ≥ ${r.autoApproveMinScore}`} hint="Lower-scoring prospects wait for your approval."><input type="range" min={0} max={100} step={5} value={r.autoApproveMinScore} onChange={(e) => setR({ autoApproveMinScore: Number(e.target.value) })} className="w-full accent-[rgb(var(--signal))]" /></Field>
        </div>
      </>}
      <Field label="Run until" group hint="Research and calling stop automatically on this date.">
        <div className="flex flex-wrap gap-2 items-center">
          <input type="date" className="input w-auto" value={v.endDate ?? ''} min={new Date().toISOString().slice(0, 10)} onChange={(e) => set({ ...v, endDate: e.target.value })} />
          {presets.map((p) => <button type="button" key={p.l} className="btn-ghost btn-sm" onClick={() => set({ ...v, endDate: new Date(Date.now() + p.d * 86400_000).toISOString().slice(0, 10) })}>{p.l}</button>)}
          {v.endDate && <button type="button" className="text-xs text-muted underline" onClick={() => set({ ...v, endDate: '' })}>No end date</button>}
        </div>
      </Field>
    </div>
  );
}

export function CampaignFields({ v, set, agents }: { v: any; set: (v: any) => void; agents: any[] }) {
  const s = v.schedule;
  const num = (k: string, min: number, max: number) => <input className="input" type="number" min={min} max={max} value={v[k]} onChange={(e) => set({ ...v, [k]: Number(e.target.value) })} />;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Campaign name"><input className="input" value={v.name} onChange={(e) => set({ ...v, name: e.target.value })} placeholder="e.g. Pune clinics — November" /></Field>
      <Field label="AI agent"><select className="input" value={v.agentId} onChange={(e) => set({ ...v, agentId: e.target.value })}>{agents.map((a) => <option key={a._id} value={a._id}>{a.name}{a.isDefault ? ' (default)' : ''}</option>)}</select></Field>
      <div className="sm:col-span-2"><Field label="Call objective" hint="Spoken briefly in the opening, e.g. “our new patient reminder service”."><input className="input" value={v.objective} onChange={(e) => set({ ...v, objective: e.target.value })} /></Field></div>
      <div className="sm:col-span-2"><Field label="Script guidance" hint="Key points the agent should cover on this campaign."><textarea className="input" rows={3} value={v.script} onChange={(e) => set({ ...v, script: e.target.value })} /></Field></div>
      <p className="sm:col-span-2 text-[13px] text-muted -mb-1">Calling hours are in <span className="font-semibold text-ink">each prospect’s local time</span> — 10:00 means 10 AM in New York for a New York salon and 10 AM in London for a London one.</p>
      <Field label="Calling days" group><div className="flex gap-1">{DAYS.map((d, i) => { const on = s.days.includes(i); return <button type="button" key={d} aria-pressed={on} onClick={() => set({ ...v, schedule: { ...s, days: on ? s.days.filter((x: number) => x !== i) : [...s.days, i].sort() } })} className={cx('h-9 flex-1 rounded-control border text-xs font-semibold', on ? 'bg-signal text-white border-signal' : 'bg-surface border-line')}>{d}</button>; })}</div></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From"><input className="input" type="time" value={s.startTime} onChange={(e) => set({ ...v, schedule: { ...s, startTime: e.target.value } })} /></Field>
        <Field label="Until"><input className="input" type="time" value={s.endTime} onChange={(e) => set({ ...v, schedule: { ...s, endTime: e.target.value } })} /></Field>
      </div>
      <Field label="Daily call limit">{num('dailyLimit', 1, 10000)}</Field>
      <Field label="Calls at the same time">{num('maxConcurrent', 1, 50)}</Field>
      <Field label="Retries for missed or busy">{num('maxRetries', 0, 10)}</Field>
      <Field label="Wait before retrying (minutes)">{num('retryDelayMinutes', 5, 10080)}</Field>
      <div className="sm:col-span-2"><Toggle checked={v.autoCalling} onChange={(x) => set({ ...v, autoCalling: x })} label="Call automatically" description="When off, the campaign holds leads but places no calls until you turn it on." /></div>
    </div>
  );
}


type PickLead = { _id: string; companyName: string; contactName?: string; phoneMasked?: string; category: string | null; priority?: number; priorityReason?: string;
  outcome: string; score: number; city?: string; state?: string; country?: string; contacted: boolean; campaigns: { _id: string; name: string; status: string; leadStatus: string }[] };

const RESULT_GROUPS: { key: string; label: string; test: (l: PickLead) => boolean; closed?: boolean; note?: string }[] = [
  { key: 'new', label: 'Not contacted yet', test: (l) => l.outcome === 'none' && !l.contacted },
  { key: 'interested', label: 'Interested', test: (l) => l.outcome === 'interested' },
  { key: 'callback', label: 'Asked for a call back', test: (l) => l.outcome === 'callback' },
  { key: 'nurture', label: 'Follow up later', test: (l) => l.outcome === 'nurture' },
  { key: 'noreach', label: 'Busy or no answer', test: (l) => ['busy', 'no_answer'].includes(l.outcome) || (l.outcome === 'none' && l.contacted) },
  { key: 'meeting', label: 'Meeting already booked', test: (l) => l.outcome === 'meeting', closed: true, note: 'They already have a meeting — usually leave these out.' },
  { key: 'not_interested', label: 'Not interested', test: (l) => l.outcome === 'not_interested', closed: true, note: 'They said no before — only call again if your offer has changed.' },
];

function GroupCheck({ ids, selected, onChange, label }: { ids: string[]; selected: Set<string>; onChange: (s: Set<string>) => void; label: string }) {
  const n = ids.filter((id) => selected.has(id)).length;
  return <input type="checkbox" aria-label={label} className="accent-[rgb(var(--signal))] h-4 w-4" checked={n > 0 && n === ids.length}
    ref={(el) => { if (el) el.indeterminate = n > 0 && n < ids.length; }}
    onClick={(e) => e.stopPropagation()}
    onChange={() => { const s = new Set(selected); ids.forEach((id) => (n === ids.length ? s.delete(id) : s.add(id))); onChange(s); }} />;
}

/** Existing leads, grouped by category, then by what happened last (or by the campaign that contacted them). */
export function LeadPicker({ selected, onChange, category }: { selected: Set<string>; onChange: (s: Set<string>) => void; category?: string }) {
  const [search, setSearch] = useState('');
  const [by, setBy] = useState<'result' | 'campaign'>('result');
  const { data, loading } = useApi<any>(`/leads/picker${qs({ search })}`);
  const items: PickLead[] = data?.items ?? [];
  const cat = category?.trim().toLowerCase();
  const cats = useMemo(() => {
    const m = new Map<string, PickLead[]>();
    for (const l of items) { const k = l.category || 'Uncategorised'; m.set(k, [...(m.get(k) ?? []), l]); }
    return [...m.entries()].sort((a, b) => (a[0].toLowerCase() === cat ? -1 : b[0].toLowerCase() === cat ? 1 : b[1].length - a[1].length));
  }, [items, cat]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (k: string, dflt: boolean) => open[k] ?? dflt;
  const flip = (k: string, dflt: boolean) => setOpen((o) => ({ ...o, [k]: !(o[k] ?? dflt) }));
  const subgroups = (leads: PickLead[]) => by === 'result'
    ? RESULT_GROUPS.map((g) => ({ key: g.key, label: g.label, closed: g.closed, note: g.note, leads: leads.filter(g.test) })).filter((g) => g.leads.length)
    : (() => { const m = new Map<string, { label: string; leads: PickLead[] }>();
        for (const l of leads) { const c = l.campaigns[0]; const k = c?._id ?? 'never'; const e = m.get(k) ?? { label: c ? `Contacted via ${c.name}` : 'Never in a campaign', leads: [] }; e.leads.push(l); m.set(k, e); }
        return [...m.entries()].sort((a, b) => (a[0] === 'never' ? -1 : b[0] === 'never' ? 1 : 0)).map(([key, e]) => ({ key, label: e.label, closed: false, note: undefined as string | undefined, leads: e.leads })); })();
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <input className="input flex-1 min-w-[180px]" placeholder="Search by business, contact or city" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search existing leads" />
        <div className="inline-flex rounded-control border border-line p-0.5 text-[12px] font-semibold" role="group" aria-label="Group leads by">
          {(['result', 'campaign'] as const).map((k) => <button type="button" key={k} aria-pressed={by === k} onClick={() => setBy(k)} className={cx('px-3 h-8 rounded-[6px]', by === k ? 'bg-ink text-paper' : 'text-muted hover:text-ink')}>{k === 'result' ? 'By result' : 'By campaign'}</button>)}
        </div>
      </div>
      <div className="border border-line rounded-control max-h-[380px] overflow-y-auto">
        {loading && !data && <p className="p-6 text-center text-muted text-[13px]">Loading…</p>}
        {data && !items.length && <p className="p-6 text-center text-muted text-[13px]">{search ? 'No leads match that search.' : 'No existing leads yet — turn on “Find new prospects automatically” in step 1.'}</p>}
        {cats.map(([name, leads], ci) => {
          const ck = `c:${name}`; const copen = isOpen(ck, cat ? name.toLowerCase() === cat : ci === 0);
          return (
            <section key={name} className="border-b border-line last:border-0">
              <div role="button" tabIndex={0} aria-expanded={copen} onClick={() => flip(ck, copen)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(ck, copen); } }}
                className="sticky top-0 z-[1] flex items-center gap-3 px-3 py-2.5 bg-sunken cursor-pointer select-none">
                <GroupCheck ids={leads.map((l) => l._id)} selected={selected} onChange={onChange} label={`Select all ${name}`} />
                <ChevronRight className={cx('h-4 w-4 text-muted transition-transform', copen && 'rotate-90')} />
                <span className="font-semibold text-[14px] flex-1">{name}{cat && name.toLowerCase() === cat && <span className="ml-2 text-[11px] font-semibold text-signal-ink bg-signal-soft rounded-full px-2 py-0.5">This campaign</span>}</span>
                <span className="text-xs text-muted tnum">{leads.filter((l) => selected.has(l._id)).length ? `${leads.filter((l) => selected.has(l._id)).length} of ` : ''}{leads.length}</span>
              </div>
              {copen && subgroups(leads).map((g) => {
                const gk = `${ck}:${by}:${g.key}`; const gopen = isOpen(gk, !g.closed);
                return (
                  <div key={g.key}>
                    <div role="button" tabIndex={0} aria-expanded={gopen} onClick={() => flip(gk, gopen)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(gk, gopen); } }}
                      className="flex items-center gap-3 pl-8 pr-3 py-2 border-t border-line cursor-pointer select-none hover:bg-sunken/60">
                      <GroupCheck ids={g.leads.map((l) => l._id)} selected={selected} onChange={onChange} label={`Select all ${g.label} in ${name}`} />
                      <ChevronRight className={cx('h-3.5 w-3.5 text-muted transition-transform', gopen && 'rotate-90')} />
                      <span className="text-[13px] font-semibold flex-1">{g.label}</span>
                      <span className="text-xs text-muted tnum">{g.leads.length}</span>
                    </div>
                    {gopen && <>
                      {g.note && <p className="pl-[60px] pr-3 pb-1 text-xs text-muted">{g.note}</p>}
                      {g.leads.map((l) => (
                        <label key={l._id} className="flex items-center gap-3 pl-[60px] pr-3 py-2 hover:bg-sunken cursor-pointer border-t border-line/60">
                          <input type="checkbox" className="accent-[rgb(var(--signal))]" checked={selected.has(l._id)} onChange={() => { const n = new Set(selected); n.has(l._id) ? n.delete(l._id) : n.add(l._id); onChange(n); }} />
                          <PriorityBadge p={l.priority} reason={l.priorityReason} />
                          <span className="flex-1 min-w-0">
                            <span className="font-semibold text-[13px] block truncate">{l.companyName}</span>
                            <span className="text-xs text-muted block truncate">{[l.contactName, [l.city, l.state].filter(Boolean).join(', '), l.phoneMasked].filter(Boolean).join(' · ')}</span>
                          </span>
                          {by === 'result'
                            ? l.campaigns[0] ? <span className="hidden sm:inline text-[11px] text-muted max-w-[160px] truncate" title={l.campaigns.map((c) => c.name).join(', ')}>via {l.campaigns[0].name}{l.campaigns.length > 1 ? ` +${l.campaigns.length - 1}` : ''}</span> : null
                            : <OutcomeBadge o={l.outcome} />}
                          <span className="tnum text-xs w-6 text-right text-muted">{l.score}</span>
                        </label>
                      ))}
                    </>}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <p className="text-xs text-muted mt-2"><span className="tnum font-semibold text-ink">{selected.size} selected</span>{data?.hiddenInRunning ? ` · ${data.hiddenInRunning} leads already queued in a running campaign are hidden` : ''} · Do-not-call numbers are never shown.</p>
    </div>
  );
}
