import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Mic, Square, Send, RotateCcw } from 'lucide-react';
import { canListen, listen, speak, stopListening, stopSpeaking } from '../lib/voice';
import { Spinner, cx } from '../components/ui';

type Msg = { who: 'agent' | 'you'; text: string };
type Phase = 'idle' | 'speaking' | 'listening' | 'thinking' | 'ended';
const BASE = import.meta.env.VITE_API_URL ?? '';
const call = (path: string, body?: any) => fetch(`${BASE}/api/demo/${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);

/**
 * Public voice demo (shared link): talk to the AI sales agent in the browser — tap once, then it's hands-free.
 * Free: the browser does speech-to-text; the voice is natural audio when configured, otherwise the browser's.
 */
export default function Talk() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [typed, setTyped] = useState('');
  const state = useRef<any>(null);
  const live = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const voiceOk = canListen();

  useEffect(() => { call(token).then(async (r) => (r.ok ? setInfo(await r.json()) : setErr((await r.json().catch(() => ({})))?.error?.message ?? 'This demo link isn’t valid.'))).catch(() => setErr('Can’t reach the server — try again in a minute.')); }, [token]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [msgs, phase]);
  useEffect(() => () => { live.current = false; stopListening(); stopSpeaking(); }, []);

  const say = async (text: string) => {
    setPhase('speaking');
    await speak(text, { lang: info?.language, fetchAudio: info?.naturalVoice ? () => call(`${token}/voice`, { text }) : undefined });
  };
  const turn = async (message?: string) => {
    setPhase('thinking');
    const r = await call(`${token}/chat`, message ? { message, state: state.current } : {});
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message ?? 'Something went wrong');
    const d = await r.json();
    state.current = d.state;
    setMsgs((m) => [...m, { who: 'agent', text: d.reply }]);
    await say(d.reply);
    return !!d.end;
  };
  /** Hands-free loop: agent speaks → we listen → send → repeat, until the call ends or you stop. */
  const loop = async () => {
    while (live.current) {
      setPhase('listening');
      const heard = await listen(info?.language).catch((e) => { setErr(e.message); live.current = false; return ''; });
      if (!live.current) break;
      if (!heard) continue; // silence — keep listening
      setMsgs((m) => [...m, { who: 'you', text: heard }]);
      if (await turn(heard)) { live.current = false; setPhase('ended'); return; }
    }
    setPhase((p) => (p === 'ended' ? p : 'idle'));
  };
  const startCall = async () => {
    setErr(''); setMsgs([]); state.current = null; live.current = true;
    try {
      const ended = await turn();
      if (ended) { live.current = false; setPhase('ended'); return; }
      if (voiceOk) await loop(); else setPhase('idle');
    } catch (e: any) { setErr(e.message); live.current = false; setPhase('idle'); }
  };
  const stopCall = () => { live.current = false; stopListening(); stopSpeaking(); setPhase('idle'); };
  const sendTyped = async () => {
    const t = typed.trim(); if (!t || phase === 'thinking') return;
    setTyped(''); setMsgs((m) => [...m, { who: 'you', text: t }]);
    try { if (await turn(t)) setPhase('ended'); else setPhase('idle'); } catch (e: any) { setErr(e.message); setPhase('idle'); }
  };

  const started = msgs.length > 0;
  const status = { idle: started ? 'Tap the mic to keep talking' : '', speaking: `${info?.agentName ?? 'Agent'} is speaking…`, listening: 'Listening — go ahead and talk', thinking: 'Thinking…', ended: 'Call ended' }[phase];
  return (
    <div className="min-h-full bg-nav text-white flex flex-col">
      <header className="px-4 sm:px-8 py-4 flex items-center justify-between">
        <span className="flex items-center gap-2 font-display font-[700]"><svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden><rect width="32" height="32" rx="8" fill="rgb(255 255 255 / .08)" /><path d="M7 16h3l2-6 3 12 3-9 2 3h5" fill="none" stroke="#2BC3B2" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>Voice demo</span>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold">AI assistant</span>
      </header>
      <main className="flex-1 w-full max-w-[560px] mx-auto px-4 pb-6 flex flex-col">
        {!info && !err && <div className="flex-1 flex items-center justify-center"><Spinner /></div>}
        {err && !info && <div className="flex-1 flex items-center justify-center text-center"><p className="text-white/80 max-w-[32ch]">{err}</p></div>}
        {info && <>
          <div className="text-center pt-4 pb-6">
            <h1 className="font-display text-[26px] sm:text-[30px] font-[650] leading-tight">Talk to {info.agentName}</h1>
            <p className="text-white/65 text-[14px] mt-1.5 max-w-[40ch] mx-auto">An AI sales assistant for {info.brand}{info.category ? `, calling ${String(info.category).toLowerCase()}` : ''}. Answer like a real customer would — busy, curious, or not interested.</p>
          </div>
          <div className="flex-1 min-h-[180px] space-y-2.5 overflow-y-auto" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={m.who === 'agent' ? 'flex' : 'flex justify-end'}>
                <p className={m.who === 'agent' ? 'rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2 max-w-[88%] text-[15px]' : 'rounded-2xl rounded-br-md bg-[#2BC3B2] text-[#05302b] px-3.5 py-2 max-w-[80%] text-[15px]'}>{m.text}</p>
              </div>
            ))}
            <div ref={end} />
          </div>
          {err && <p className="text-[13px] text-[#ffb4a6] text-center mt-3" role="alert">{err}</p>}
          <div className="pt-5 flex flex-col items-center gap-3">
            <p className="text-[13px] text-white/70 h-5">{status}</p>
            {phase === 'ended' ? (
              <button className="h-14 px-6 rounded-full bg-white text-ink font-semibold inline-flex items-center gap-2" onClick={startCall}><RotateCcw className="h-5 w-5" />Try another call</button>
            ) : live.current ? (
              <button aria-label="End the call" className="h-20 w-20 rounded-full bg-[#e5484d] inline-flex items-center justify-center shadow-lg" onClick={stopCall}><Square className="h-7 w-7 fill-white" /></button>
            ) : (
              <button aria-label={started ? 'Talk' : 'Start the call'} onClick={started && voiceOk ? () => { live.current = true; setErr(''); void loop(); } : startCall}
                className={cx('h-20 w-20 rounded-full bg-[#2BC3B2] text-[#05302b] inline-flex items-center justify-center shadow-lg', phase === 'thinking' && 'opacity-70')} disabled={phase === 'thinking'}>
                {phase === 'thinking' ? <Spinner /> : <Mic className="h-8 w-8" />}
              </button>
            )}
            {!started && phase === 'idle' && <p className="text-[12px] text-white/55">Tap to start. Your browser will ask to use the microphone.</p>}
            {(!voiceOk || started) && phase !== 'ended' && (
              <form className="w-full flex gap-2 mt-1" onSubmit={(e) => { e.preventDefault(); void sendTyped(); }}>
                <input className="flex-1 h-11 rounded-full bg-white/10 px-4 text-[15px] placeholder:text-white/40 outline-none focus:ring-2 focus:ring-[#2BC3B2]" placeholder={voiceOk ? 'Or type a reply…' : 'Voice isn’t supported here — type your reply'} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type a reply" />
                <button className="h-11 w-11 rounded-full bg-white/15 inline-flex items-center justify-center" aria-label="Send"><Send className="h-4 w-4" /></button>
              </form>
            )}
          </div>
          <p className="text-[11px] text-white/45 text-center mt-6">This is a demo conversation with an AI assistant. Nothing here places a real phone call.</p>
        </>}
      </main>
    </div>
  );
}
