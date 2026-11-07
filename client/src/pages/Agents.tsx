import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Trash2, Star, RotateCcw, Send, CalendarCheck, PhoneForwarded, Ban, Play, Square, Mic, Upload, Volume2, VolumeX, Clock3, XCircle, Info } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { post, patch, del, upload, api } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { PageHeader, Panel, Field, Spinner, Pill, Confirm, ErrorState, Skeleton, Modal, Avatar, cx } from '../components/ui';

const LANGS = [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-AU', 'English (Australia)'], ['en-IN', 'English (India)']];

/** Plays a voice sample: ElevenLabs audio from the server, or the browser’s most natural matching voice as a fallback. */
let current: HTMLAudioElement | null = null;
export async function playVoice(agentId: string, opts: { voiceId?: string; text?: string; accent?: string; gender?: string; rate?: number }, onEnd: () => void) {
  stopVoice();
  try {
    const res: Response = await api(`/agents/${agentId}/voice-preview`, { method: 'POST', body: { voiceId: opts.voiceId, text: opts.text }, raw: true });
    if (res.status === 200) {
      const url = URL.createObjectURL(await res.blob());
      current = new Audio(url); current.onended = () => { onEnd(); URL.revokeObjectURL(url); };
      await current.play(); return 'elevenlabs';
    }
  } catch { /* fall back */ }
  if (!('speechSynthesis' in window)) { onEnd(); return 'none'; }
  const u = new SpeechSynthesisUtterance(opts.text ?? 'Hey, it’s Sarah. Quick heads-up, I’m an AI assistant on the sales team. Did I catch you at an okay time?');
  const lang = opts.accent === 'British' ? 'en-GB' : 'en-US';
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith(lang) || v.lang.startsWith('en'));
  const female = /female|samantha|victoria|karen|moira|serena|zira|jenny|aria|sonia|libby|google (us|uk) english$/i;
  const male = /male|daniel|alex|fred|guy|ryan|google uk english male/i;
  u.voice = vs.find((v) => v.lang.startsWith(lang) && (opts.gender === 'male' ? male : female).test(v.name)) ?? vs.find((v) => v.lang.startsWith(lang)) ?? vs[0] ?? null;
  u.rate = opts.rate ?? 1; u.pitch = 1;
  u.onend = onEnd;
  speechSynthesis.speak(u);
  return 'browser';
}
export function stopVoice() { current?.pause(); current = null; if ('speechSynthesis' in window) speechSynthesis.cancel(); }

export default function Agents() {
  const can = useAuth((s) => s.can('agents:write'));
  const { data, error, reload } = useApi<any>('/agents');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [remove, setRemove] = useState(false);
  useEffect(() => { if (data && !selected && data.agents[0]) setSelected(data.agents[0]._id); }, [data, selected]);
  const agent = data?.agents.find((a: any) => a._id === selected);
  useEffect(() => { if (agent) setDraft(structuredClone(agent)); }, [agent]);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data || !draft) return <Skeleton className="h-96" />;
  const set = (k: string, v: any) => setDraft((d: any) => ({ ...d, [k]: v }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(agent);
  const save = async () => {
    setSaving(true);
    try {
      const { _id, businessId, createdAt, updatedAt, __v, clonedVoice, ...body } = draft;
      body.objectionHandling = (body.objectionHandling ?? []).filter((o: any) => o.objection?.trim() && o.response?.trim());
      for (const k of Object.keys(body)) if (body[k] === null || body[k] === '') delete body[k];
      await patch(`/agents/${_id}`, body); toast.success(`${draft.name} saved`); reload();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <>
      <PageHeader title="AI agents" description="Your AI sales team. Give each one a voice, a sales style and a playbook — then rehearse a call before it dials anyone."
        actions={can && <button className="btn-secondary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New agent</button>} />
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {data.agents.map((a: any) => (
          <button key={a._id} onClick={() => setSelected(a._id)} className={cx('flex items-center gap-2 rounded-full border pl-1.5 pr-3.5 h-10 text-[13px] font-semibold whitespace-nowrap', a._id === selected ? 'bg-ink text-paper border-ink' : 'bg-surface border-line hover:bg-sunken')}>
            <Avatar name={a.name} size={28} />{a.name}{a.isDefault && <Star className="h-3.5 w-3.5 fill-current" aria-label="Default agent" />}
          </button>
        ))}
      </div>

      {/* Profile hero */}
      <section className="panel p-5 mb-6 flex flex-wrap items-center gap-5">
        <div className="h-16 w-16 rounded-full bg-signal text-white dark:text-paper flex items-center justify-center font-display text-2xl font-[750] shrink-0">{draft.name?.[0] ?? 'A'}</div>
        <div className="flex-1 min-w-[220px]">
          <p className="font-display text-xl font-[650] leading-tight">{draft.name} <span className="text-muted font-normal text-base">· {draft.title || 'Account Executive'}</span></p>
          <p className="text-[13px] text-muted mt-0.5 max-w-[70ch]">{draft.experience}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Pill tone="green">{draft.voiceProvider === 'elevenlabs' ? (draft.clonedVoice?.name ? `Voice: ${draft.clonedVoice.name}` : `Voice: ${data.naturalVoices.find((v: any) => v.id === draft.elevenVoiceId)?.name ?? 'natural'}`) : 'Carrier voice'}</Pill>
            <Pill tone="blue">{draft.style === 'formal' ? 'Polished & formal' : 'Natural & conversational'}</Pill>
            <Pill>{LANGS.find((l) => l[0] === draft.language)?.[1] ?? draft.language}</Pill>
          </div>
        </div>
        {can && <div className="flex flex-wrap gap-2">
          {!draft.isDefault && <button className="btn-ghost btn-sm" onClick={async () => { await patch(`/agents/${draft._id}`, { isDefault: true }); reload(); toast.success(`${draft.name} is now the default agent`); }}><Star className="h-4 w-4" />Make default</button>}
          {!draft.isDefault && <button className="btn-ghost btn-sm" onClick={() => setRemove(true)}><Trash2 className="h-4 w-4" />Delete</button>}
          <button className="btn-primary" onClick={save} disabled={saving || !dirty}>{saving && <Spinner />}{dirty ? 'Save changes' : 'Saved'}</button>
        </div>}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6 min-w-0">
          <Panel title="Sales executive">
            <fieldset disabled={!can} className="grid gap-4 md:grid-cols-2">
              <Field label="Name"><input className="input" value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field label="Job title"><input className="input" value={draft.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="Senior Account Executive" /></Field>
              <div className="md:col-span-2"><Field label="Sales background" hint="Shapes how the agent sells — confident, consultative, closes. It’s never claimed on the call as a personal fact."><textarea className="input" rows={2} value={draft.experience ?? ''} onChange={(e) => set('experience', e.target.value)} /></Field></div>
              <Field label="How it talks">
                <div className="grid grid-cols-2 gap-2">{[['natural', 'Natural', 'Relaxed, casual, like a top rep on the phone'], ['formal', 'Formal', 'Polished and buttoned-up']].map(([k, l, d]) => (
                  <button type="button" key={k} aria-pressed={draft.style === k} onClick={() => set('style', k)} className={cx('rounded-control border p-3 text-left', (draft.style ?? 'natural') === k ? 'border-signal bg-signal-soft/60' : 'border-line hover:bg-sunken')}><span className="font-semibold block text-[13px]">{l}</span><span className="text-xs text-muted">{d}</span></button>
                ))}</div>
              </Field>
              <Field label="Language"><select className="input" value={draft.language} onChange={(e) => set('language', e.target.value)}>{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <div className="md:col-span-2"><Field label="Goal of every call"><input className="input" value={draft.objective ?? ''} onChange={(e) => set('objective', e.target.value)} /></Field></div>
              <div className="md:col-span-2"><Field label="Opening line" hint="Use {{name}}, {{company}}, {{business}}. A one-line “I’m an AI assistant” note is added if it isn’t there."><textarea className="input" rows={2} value={draft.openingLine ?? ''} onChange={(e) => set('openingLine', e.target.value)} placeholder="Hey {{name}}, it’s Sarah from {{business}}." /></Field></div>
              <div className="md:col-span-2"><Field label="Extra instructions" hint="Used when an OpenAI key is configured."><textarea className="input" rows={2} value={draft.instructions ?? ''} onChange={(e) => set('instructions', e.target.value)} placeholder="e.g. Always mention the 14-day free trial. Never discuss competitor pricing." /></Field></div>
              <Field label="Transfer to a human"><input className="input" value={draft.transferNumber ?? ''} onChange={(e) => set('transferNumber', e.target.value)} placeholder="+1 …" /></Field>
              <Field label="Max call length (minutes)"><input className="input" type="number" min={1} max={30} value={draft.maxCallMinutes ?? 8} onChange={(e) => set('maxCallMinutes', Number(e.target.value))} /></Field>
            </fieldset>
          </Panel>

          <VoiceStudio draft={draft} set={set} data={data} can={can} onCloned={reload} />

          <Panel title="Objection playbook" actions={can && <button className="btn-secondary btn-sm" onClick={() => set('objectionHandling', [...(draft.objectionHandling ?? []), { objection: '', response: '' }])}><Plus className="h-4 w-4" />Add</button>}>
            {!draft.objectionHandling?.length && <p className="text-muted text-[13px]">Teach your agent how to handle pushback like “it’s too expensive” or “we already have someone”.</p>}
            <div className="space-y-3">
              {draft.objectionHandling?.map((o: any, i: number) => (
                <div key={i} className="rounded-control border border-line p-3 grid gap-2 md:grid-cols-[1fr_1.6fr_auto] items-start">
                  <Field label="When they say"><input className="input" disabled={!can} value={o.objection} onChange={(e) => set('objectionHandling', draft.objectionHandling.map((x: any, j: number) => j === i ? { ...x, objection: e.target.value } : x))} /></Field>
                  <Field label="Respond with"><textarea className="input" disabled={!can} rows={3} value={o.response} onChange={(e) => set('objectionHandling', draft.objectionHandling.map((x: any, j: number) => j === i ? { ...x, response: e.target.value } : x))} /></Field>
                  {can && <button className="btn-ghost h-9 w-9 p-0 mt-6" aria-label="Remove objection" onClick={() => set('objectionHandling', draft.objectionHandling.filter((_: any, j: number) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
            </div>
          </Panel>
        </div>
        <TestChat agentId={draft._id} name={draft.name} engine={data.runtime.llm} voice={{ voiceId: draft.voiceProvider === 'elevenlabs' ? draft.elevenVoiceId : undefined, accent: draft.language === 'en-GB' ? 'British' : 'American', rate: draft.speakingRate }} dirty={dirty} />
      </div>
      <CreateAgent open={creating} onClose={() => setCreating(false)} onCreated={(id) => { reload(); setSelected(id); }} />
      <Confirm open={remove} onClose={() => setRemove(false)} danger title={`Delete ${draft.name}?`} confirmLabel="Delete agent" message="Campaigns using this agent must be finished first."
        onConfirm={async () => { try { await del(`/agents/${draft._id}`); setSelected(null); reload(); toast.success('Agent deleted'); } catch (e: any) { toast.error(e.message); } }} />
    </>
  );
}

function VoiceStudio({ draft, set, data, can, onCloned }: { draft: any; set: (k: string, v: any) => void; data: any; can: boolean; onCloned: () => void }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const eleven = data.runtime.elevenlabs;
  const play = async (id: string, v?: any) => {
    if (playing === id) { stopVoice(); setPlaying(null); return; }
    setPlaying(id);
    const how = await playVoice(draft._id, { voiceId: v?.id ?? (id === 'clone' ? draft.elevenVoiceId : undefined), accent: v?.accent, gender: v?.gender, rate: draft.speakingRate, text: `Hey, it’s ${draft.name}. Quick heads-up, I’m an AI assistant on the sales team — did I catch you at an okay time?` }, () => setPlaying(null));
    if (how === 'browser' && !eleven) toast.info('Previewing with your browser’s voice. Add an ElevenLabs key on the server to hear the real voice.');
  };
  const choose = (v: any) => { set('voiceProvider', 'elevenlabs'); set('elevenVoiceId', v.id); if (v.accent === 'British' && draft.language === 'en-US') set('language', 'en-GB'); };
  return (
    <Panel title="Voice" actions={can && <button className="btn-secondary btn-sm" onClick={() => setCloneOpen(true)}><Mic className="h-4 w-4" />Use my own voice</button>}>
      {!eleven && <div className="flex gap-2 rounded-control bg-cold/10 p-3 text-[13px] mb-4"><Info className="h-4 w-4 text-cold shrink-0 mt-0.5" /><p>These lifelike voices play on real calls once <b>ELEVENLABS_API_KEY</b> is set on the server. Until then, previews use your browser’s voice and calls use the carrier voice below.</p></div>}
      {draft.clonedVoice?.name && (
        <button type="button" onClick={() => set('voiceProvider', 'elevenlabs')} className={cx('w-full mb-3 rounded-control border p-3 flex items-center gap-3 text-left', draft.voiceProvider === 'elevenlabs' && draft.clonedVoice ? 'border-signal bg-signal-soft/60' : 'border-line')}>
          <Mic className="h-5 w-5 text-signal" /><span className="flex-1"><span className="font-semibold block">{draft.clonedVoice.name}</span><span className="text-xs text-muted">Your cloned voice · consent recorded {new Date(draft.clonedVoice.consentAt).toLocaleDateString()}</span></span>
          <span role="button" tabIndex={0} className="btn-ghost h-8 w-8 p-0" aria-label="Preview cloned voice" onClick={(e) => { e.stopPropagation(); play('clone'); }}>{playing === 'clone' ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}</span>
        </button>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.naturalVoices.map((v: any) => {
          const on = draft.voiceProvider === 'elevenlabs' && draft.elevenVoiceId === v.id;
          return (
            <div key={v.id} className={cx('rounded-control border p-3 flex items-start gap-3', on ? 'border-signal bg-signal-soft/60' : 'border-line')}>
              <button type="button" onClick={() => play(v.id, v)} aria-label={`Preview ${v.name}`} className={cx('h-9 w-9 rounded-full flex items-center justify-center shrink-0', playing === v.id ? 'bg-ink text-paper' : 'bg-sunken hover:bg-line')}>{playing === v.id ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}</button>
              <button type="button" disabled={!can} onClick={() => choose(v)} className="text-left flex-1 min-w-0">
                <span className="font-semibold text-[14px] block">{v.name} <span className="text-xs text-muted font-normal">{v.accent} · {v.gender}</span></span>
                <span className="text-xs text-muted leading-snug block">{v.vibe}</span>
                {on && <span className="text-xs font-semibold text-signal-ink">Selected</span>}
              </button>
            </div>
          );
        })}
      </div>
      <div className="grid gap-4 md:grid-cols-2 mt-5">
        <Field label="Carrier voice (fallback)" hint="Used on Twilio calls when no natural voice is available."><select className="input" disabled={!can} value={draft.voice} onChange={(e) => set('voice', e.target.value)}>{data.voices.map((v: any) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></Field>
        <Field label={`Speaking pace · ${Number(draft.speakingRate ?? 1).toFixed(1)}×`}><input type="range" min={0.8} max={1.2} step={0.05} value={draft.speakingRate ?? 1} onChange={(e) => set('speakingRate', Number(e.target.value))} className="w-full accent-[rgb(var(--signal))]" /></Field>
      </div>
      <CloneVoice open={cloneOpen} onClose={() => setCloneOpen(false)} agentId={draft._id} enabled={eleven} onDone={onCloned} />
    </Panel>
  );
}

function CloneVoice({ open, onClose, agentId, enabled, onDone }: { open: boolean; onClose: () => void; agentId: string; enabled: boolean; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const record = async () => {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream); const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); setFiles((f) => [...f, new File([new Blob(chunks, { type: mr.mimeType })], `recording-${f.length + 1}.webm`, { type: mr.mimeType })]); setRec(null); };
      mr.start(); setRec(mr);
    } catch { toast.error('Microphone access was blocked. Upload a recording instead.'); }
  };
  const submit = async () => {
    const fd = new FormData(); files.forEach((f) => fd.append('samples', f)); fd.append('name', name); fd.append('consent', String(consent));
    setBusy(true);
    try { await upload(`/agents/${agentId}/voice-clone`, fd); toast.success('Your voice is ready — preview it in the Voice panel'); onDone(); onClose(); setFiles([]); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Use your own voice" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!enabled || !files.length || !consent || busy} onClick={submit}>{busy && <Spinner />}Create my voice</button></>}>
      <div className="space-y-4">
        {!enabled && <p className="rounded-control bg-hot/10 p-3 text-[13px]">Voice cloning needs <b>ELEVENLABS_API_KEY</b> on the server.</p>}
        <p className="text-[13px] text-muted">Record or upload 1–3 minutes of clear speech — read a paragraph about your business in your normal sales voice, in a quiet room.</p>
        <Field label="Voice name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Abbas" /></Field>
        <div className="flex gap-2">
          <button type="button" className={cx('btn flex-1', rec ? 'btn-danger' : 'btn-secondary')} onClick={record}>{rec ? <><Square className="h-4 w-4" />Stop recording</> : <><Mic className="h-4 w-4" />Record now</>}</button>
          <button type="button" className="btn-secondary flex-1" onClick={() => ref.current?.click()}><Upload className="h-4 w-4" />Upload audio</button>
          <input ref={ref} type="file" accept="audio/*" multiple className="hidden" onChange={(e) => e.target.files && setFiles([...files, ...Array.from(e.target.files)])} />
        </div>
        {files.length > 0 && <ul className="text-[13px] space-y-1">{files.map((f, i) => <li key={i} className="flex justify-between rounded-control bg-sunken px-3 py-1.5"><span className="truncate">{f.name}</span><button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button></li>)}</ul>}
        <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-0.5 accent-[rgb(var(--signal))]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />This is my own voice, or I have the speaker’s written permission to clone it for this business’s sales calls.</label>
      </div>
    </Modal>
  );
}

function CreateAgent({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="New agent" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!name.trim() || busy} onClick={async () => { setBusy(true); try { const a = await post('/agents', { name }); onCreated(a._id); onClose(); setName(''); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }}>{busy && <Spinner />}Create agent</button></>}>
      <Field label="Agent name" hint="The name it introduces itself with on calls."><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kabir" /></Field>
    </Modal>
  );
}

type Msg = { role: 'agent' | 'you'; text: string; actions?: any[] };
function TestChat({ agentId, name, engine, voice, dirty }: { agentId: string; name: string; engine: string; voice: { voiceId?: string; accent: string; rate?: number }; dirty: boolean }) {
  const [speak, setSpeak] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [state, setState] = useState<any>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  const [campaignId, setCampaignId] = useState('');
  const campaigns = useApi<any>('/campaigns').data?.items ?? [];
  const end = useRef<HTMLDivElement>(null);
  const begin = async (cid = campaignId) => {
    setBusy(true); setEnded(false);
    try { const r = await post(`/agents/${agentId}/test-chat`, cid ? { campaignId: cid } : {}); setMsgs([{ role: 'agent', text: r.reply }]); setState(r.state); if (speak) void playVoice(agentId, { ...voice, text: r.reply }, () => undefined); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { void begin(); /* eslint-disable-next-line */ }, [agentId]);
  const asCampaign = campaigns.find((c: any) => c._id === campaignId);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [msgs]);
  const send = async (e?: FormEvent) => {
    e?.preventDefault(); if (!text.trim() || ended) return;
    const t = text; setText(''); setMsgs((m) => [...m, { role: 'you', text: t }]); setBusy(true);
    try { const r = await post(`/agents/${agentId}/test-chat`, { message: t, state, ...(campaignId ? { campaignId } : {}) }); setState(r.state); setMsgs((m) => [...m, { role: 'agent', text: r.reply, actions: r.actions }]); if (r.end) setEnded(true); if (speak) void playVoice(agentId, { ...voice, text: r.reply }, () => undefined); }
    catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  };
  const suggestions = ['Sure, go ahead', 'How much does it cost?', 'Wait, are you a real person?', 'Not now, maybe in two months', "I'm busy, call me tomorrow at 4pm", "We're not interested", 'Thursday at 11am works', 'Please don’t call again'];
  return (
    <section className="panel flex flex-col h-[640px] xl:sticky xl:top-20" aria-label="Test conversation">
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-line">
        <div><h2 className="text-[15px] font-[650]">Test call with {name}</h2><p className="text-xs text-muted">You play {asCampaign?.category ? `a ${asCampaign.category.toLowerCase().replace(/s$/, '')} owner` : 'the prospect'} · engine: {engine}{dirty ? ' · save to test your edits' : ''}</p></div>
        <div className="flex gap-1">
          <button className={cx('btn-ghost btn-sm', speak && 'text-signal')} onClick={() => { if (speak) stopVoice(); setSpeak(!speak); }} aria-pressed={speak} title="Hear the agent’s replies">{speak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}<span className="sr-only">Speak replies</span></button>
          <button className="btn-ghost btn-sm" onClick={() => begin()} aria-label="Restart test"><RotateCcw className="h-4 w-4" />Restart</button>
        </div>
      </header>
      {campaigns.length > 0 && <div className="flex items-center gap-2 px-5 py-2 border-b border-line text-[12px]"><span className="text-muted shrink-0">Practise as</span><select className="input h-8 flex-1 min-w-0 text-[12px] py-0" aria-label="Practise as campaign" value={campaignId} onChange={(e) => { setCampaignId(e.target.value); void begin(e.target.value); }}><option value="">General call</option>{campaigns.map((c: any) => <option key={c._id} value={c._id}>{c.category ? `${c.category} · ` : ''}{c.name}</option>)}</select></div>}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'agent' ? 'flex flex-col items-start' : 'flex flex-col items-end'}>
            <p className={cx('max-w-[88%] px-3.5 py-2.5 text-[14px] leading-relaxed', m.role === 'agent' ? 'bg-sunken rounded-2xl rounded-bl-sm' : 'bg-signal text-white rounded-2xl rounded-br-sm')}>{m.text}</p>
            {m.actions?.map((a, j) => (
              <span key={j} className="mt-1.5"><Pill tone={a.type === 'opt_out' ? 'red' : a.type === 'book' ? 'green' : a.type === 'not_interested' ? 'grey' : 'blue'}>
                {a.type === 'book' ? <><CalendarCheck className="h-3 w-3" />{a.kind === 'meeting' ? `Google Meet booked${a.with === 'owner' ? ' with founder' : ''}` : 'Callback booked'} · {a.display ?? new Date(a.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })} (their time)</> : a.type === 'opt_out' ? <><Ban className="h-3 w-3" />Added to Do-Not-Call</> : a.type === 'nurture' ? <><Clock3 className="h-3 w-3" />Follow up in {a.label}</> : a.type === 'not_interested' ? <><XCircle className="h-3 w-3" />Not interested — closed</> : a.type === 'transfer' ? <><PhoneForwarded className="h-3 w-3" />Transfer to {a.number}</> : a.type === 'recording_consent' ? `Recording consent: ${a.granted ? 'yes' : 'no'}` : a.type}
              </Pill></span>
            ))}
          </div>
        ))}
        {busy && <div className="flex gap-1 px-3 py-2"><span className="h-2 w-2 rounded-full bg-muted/50 animate-bounce" /><span className="h-2 w-2 rounded-full bg-muted/50 animate-bounce [animation-delay:120ms]" /><span className="h-2 w-2 rounded-full bg-muted/50 animate-bounce [animation-delay:240ms]" /></div>}
        {ended && <p className="text-center text-xs text-muted py-2">Call ended · <button className="underline" onClick={() => begin()}>start again</button></p>}
        <div ref={end} />
      </div>
      {!ended && <div className="px-5 pb-2 flex gap-1.5 overflow-x-auto">{suggestions.map((s) => <button key={s} className="rounded-full border border-line px-2.5 py-1 text-xs whitespace-nowrap hover:bg-sunken" onClick={() => setText(s)}>{s}</button>)}</div>}
      <form onSubmit={send} className="flex gap-2 p-4 pt-2 border-t border-line">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} disabled={ended} placeholder={ended ? 'Call ended' : 'Reply as the prospect…'} aria-label="Your reply" />
        <button className="btn-primary w-10 p-0" disabled={busy || ended || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></button>
      </form>
    </section>
  );
}
