import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../lib/api';
import { useAuth } from '../store/auth';
import { Field, Spinner } from '../components/ui';

const STEPS = [
  { t: 'Finds the right businesses', d: 'Pick a category and an area — salons in Texas, NGOs in London. It researches new prospects daily and ranks who needs you most.' },
  { t: 'Calls like your best salesperson', d: 'Says up front it’s an AI assistant, asks about their problem, explains the one thing that fixes it, and handles “not interested” politely.' },
  { t: 'Books the meeting for you', d: 'Agrees a time in their local timezone, sends a Google Meet invite, and remembers to call back the ones who said “not now”.' },
];
const DELIVERS = ['Meetings on your calendar', 'A brief before every meeting', 'Follow-ups it never forgets', 'Call recordings and reports'];
const CALL: { who: 'agent' | 'them'; text: string }[] = [
  { who: 'agent', text: 'Hi Jessica, it’s Sarah — I’m an AI assistant with GlowDesk. We help salons stop losing money to no-shows. Got 30 seconds?' },
  { who: 'them', text: 'Sure. Honestly the no-shows are killing us.' },
  { who: 'agent', text: 'Roughly how many a week? … So about 20 a month. Worth 15 minutes on Google Meet — Tuesday or Wednesday?' },
  { who: 'them', text: 'Wednesday at 11 works.' },
];

/** The sample call plays out once on load (instantly for people who prefer reduced motion). */
function SampleCall() {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(reduce ? CALL.length + 1 : 1);
  useEffect(() => {
    if (reduce || shown > CALL.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 1 ? 1400 : 1700);
    return () => clearTimeout(t);
  }, [shown, reduce]);
  return (
    <div className="rounded-2xl bg-white/[0.06] ring-1 ring-white/10 p-4 sm:p-5" aria-label="Example call">
      <div className="flex items-center justify-between text-[12px] text-white/60 mb-3">
        <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#2BC3B2] live-dot" />Example call</span>
        <span className="tnum">Copper &amp; Co. Salon, Austin</span>
      </div>
      <div className="space-y-2.5 text-[14px] leading-snug min-h-[196px]">
        {CALL.slice(0, Math.min(shown, CALL.length)).map((m, i) => (
          <div key={i} className={m.who === 'agent' ? 'flex auth-in' : 'flex justify-end auth-in'}>
            <p className={m.who === 'agent' ? 'rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2 max-w-[88%]' : 'rounded-2xl rounded-br-md bg-[#2BC3B2] text-[#05302b] px-3.5 py-2 max-w-[80%]'}>{m.text}</p>
          </div>
        ))}
      </div>
      <div className={'mt-4 flex flex-wrap gap-2 transition-opacity duration-500 ' + (shown > CALL.length ? 'opacity-100' : 'opacity-0')} aria-hidden={shown <= CALL.length}>
        <span className="rounded-full bg-[#2BC3B2]/15 text-[#7fe3d6] px-3 py-1 text-[12px] font-semibold">Meeting booked — Wed 11:00 their time</span>
        <span className="rounded-full bg-white/10 text-white/80 px-3 py-1 text-[12px] font-semibold">Brief ready: no-shows, ~20 a month</span>
      </div>
    </div>
  );
}

function Delivers({ compact = true }: { compact?: boolean }) {
  return (
    <div>
      <h2 className={compact ? 'text-[16px] font-[650] mb-3' : 'text-[17px] font-[650] mb-3 text-white/90'}>What you get</h2>
      <ul className="grid grid-cols-2 gap-2">
        {DELIVERS.map((d) => <li key={d} className={'rounded-control px-3 py-2.5 text-[13px] font-medium ' + (compact ? 'bg-sunken' : 'bg-white/[0.06] ring-1 ring-white/10')}>{d}</li>)}
      </ul>
    </div>
  );
}

function Explainer({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-6' : 'space-y-7'}>
      {!compact && <p className="font-display text-[38px] xl:text-[42px] leading-[1.04] font-[650] max-w-[16ch]">Your AI sales rep, on the phone all day.</p>}
      {compact ? <div className="bg-nav text-white rounded-[18px]"><SampleCall /></div> : <SampleCall />}
      <div>
        <h2 className={compact ? 'text-[16px] font-[650] mb-3' : 'text-[17px] font-[650] mb-4 text-white/90'}>How it works</h2>
        <ol className={compact ? 'space-y-4' : 'space-y-3'}>
          {STEPS.map((s, i) => (
            <li key={s.t} className="grid grid-cols-[28px_1fr] gap-3">
              <span className={'h-7 w-7 rounded-full flex items-center justify-center text-[13px] font-bold tnum ' + (compact ? 'bg-signal-soft text-signal-ink' : 'bg-white/10 text-white')}>{i + 1}</span>
              <span><span className="font-semibold block">{s.t}</span><span className={compact ? 'text-muted text-[14px]' : 'text-white/65 text-[14px]'}>{s.d}</span></span>
            </li>
          ))}
        </ol>
      </div>
      {compact && <Delivers />}
    </div>
  );
}

function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden><rect width="32" height="32" rx="8" fill={light ? 'rgb(255 255 255 / .08)' : 'rgb(var(--ink))'} /><path d="M7 16h3l2-6 3 12 3-9 2 3h5" fill="none" stroke="#2BC3B2" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span className="font-display text-[19px] font-[750]">Dialstack</span>
      <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + (light ? 'bg-[#2BC3B2]/20 text-[#7fe3d6]' : 'bg-signal-soft text-signal-ink')}>Beta</span>
    </span>
  );
}

function Shell({ children, title, sub }: { children: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="min-h-full grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)] bg-paper">
      <aside className="hidden lg:flex bg-nav text-white flex-col px-10 py-9 xl:px-14 gap-8 overflow-y-auto">
        <Logo light />
        <div className="flex-1 flex items-center"><div className="w-full max-w-[34rem]"><Explainer /></div></div>
        <p className="text-white/50 text-[13px]">Every call starts by saying it’s an AI assistant. Anyone who asks not to be called is never called again.</p>
      </aside>
      <main className="flex flex-col">
        <div className="flex-1 flex items-center justify-center px-4 py-10 sm:px-10">
          <div className="w-full max-w-[380px]">
            <div className="lg:hidden mb-8"><Logo /></div>
            <h1 className="text-[28px] font-[650]">{title}</h1>
            <p className="text-muted mt-1 mb-7">{sub}</p>
            {children}
            <div className="hidden lg:block mt-10 pt-8 border-t border-line"><Delivers /></div>
            <p className="text-[12px] text-muted mt-8 rounded-control bg-sunken px-3 py-2.5">You’re using an early beta. Things may change quickly — tell us what you think.</p>
          </div>
        </div>
        <section className="lg:hidden border-t border-line px-4 sm:px-10 py-10 bg-surface"><div className="max-w-[560px] mx-auto"><Explainer compact /></div></section>
      </main>
    </div>
  );
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const setSession = useAuth((s) => s.setSession);
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '', businessName: '', website: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const on = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const body = mode === 'login' ? { email: f.email, password: f.password } : { ...f, website: f.website || undefined };
      setSession(await post(`/auth/${mode}`, body));
      nav(mode === 'register' ? '/settings?welcome=1' : '/');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell title={mode === 'login' ? 'Sign in' : 'Create your workspace'} sub={mode === 'login' ? 'Welcome back — here’s what your agent got done.' : 'Set up your business and train your AI agent in a few minutes.'}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {mode === 'register' && <>
          <Field label="Your name"><input className="input" value={f.name} onChange={on('name')} autoComplete="name" required /></Field>
          <Field label="Business name (optional)" hint="Freelancer? Leave it blank — your agent will introduce itself as working with you, by first name."><input className="input" value={f.businessName} onChange={on('businessName')} autoComplete="organization" placeholder="e.g. GlowDesk" /></Field>
          <Field label="Website" hint="Optional — you can import it into the knowledge base later."><input className="input" value={f.website} onChange={on('website')} placeholder="https://" /></Field>
        </>}
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={on('email')} autoComplete="email" required /></Field>
        <Field label="Password" hint={mode === 'register' ? 'At least 8 characters, with a letter and a number.' : undefined}><input className="input" type="password" value={f.password} onChange={on('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></Field>
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <button className="btn-primary w-full h-10" disabled={busy}>{busy && <Spinner />}{mode === 'login' ? 'Sign in' : 'Create workspace'}</button>
      </form>
      <p className="text-sm text-muted mt-6 text-center">
        {mode === 'login' ? <>New to Dialstack? <Link className="text-signal font-semibold" to="/register">Create a workspace</Link></> : <>Already have an account? <Link className="text-signal font-semibold" to="/login">Sign in</Link></>}
      </p>
    </Shell>
  );
}

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const setSession = useAuth((s) => s.setSession);
  const nav = useNavigate();
  const [name, setName] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { setSession(await post('/auth/accept-invite', { token: params.get('token'), name, password })); nav('/'); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell title="Join your team" sub="Set your name and password to accept the invitation.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Password" hint="At least 8 characters, with a letter and a number."><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <button className="btn-primary w-full h-10" disabled={busy}>{busy && <Spinner />}Accept invitation</button>
      </form>
    </Shell>
  );
}
