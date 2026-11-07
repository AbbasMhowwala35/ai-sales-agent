import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../lib/api';
import { useAuth } from '../store/auth';
import { Field, Spinner } from '../components/ui';

function Shell({ children, title, sub }: { children: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="min-h-full grid lg:grid-cols-[1fr_520px]">
      <div className="hidden lg:flex bg-nav text-white flex-col justify-between p-12 relative overflow-hidden">
        <div className="flex items-center gap-2.5"><svg viewBox="0 0 32 32" className="h-9 w-9"><rect width="32" height="32" rx="8" fill="rgb(255 255 255 / .08)" /><path d="M7 16h3l2-6 3 12 3-9 2 3h5" fill="none" stroke="#2BC3B2" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg><span className="font-display text-xl font-[750]">Dialstack</span></div>
        <div className="max-w-[30rem]">
          <p className="font-display text-[44px] leading-[1.05] font-[650]">An AI sales rep that finds your next customers and calls them.</p>
          <div className="mt-10 space-y-3 text-[15px]">
            {[['agent', 'Hi Priya, this is Aria, an AI assistant calling on behalf of Acme. Is now an okay time?'], ['customer', 'Sure — what is it about?'], ['agent', 'We help clinics follow up with patients automatically. How do you handle reminders today?']].map(([s, t], i) => (
              <div key={i} className={s === 'agent' ? 'flex' : 'flex justify-end'}>
                <p className={s === 'agent' ? 'rounded-2xl rounded-bl-sm bg-white/10 px-4 py-2.5 max-w-[85%]' : 'rounded-2xl rounded-br-sm bg-[#2BC3B2] text-[#062b28] px-4 py-2.5 max-w-[85%]'}>{t}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-white/50 text-sm">Discloses it’s an AI on every call. Honours opt-outs instantly.</p>
      </div>
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[400px]">
          <h1 className="text-[28px] font-[650]">{title}</h1>
          <p className="text-muted mt-1 mb-7">{sub}</p>
          {children}
        </div>
      </div>
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
    <Shell title={mode === 'login' ? 'Sign in' : 'Create your workspace'} sub={mode === 'login' ? 'Welcome back. Your agents kept working while you were away.' : 'Set up your business and train your AI agent in a few minutes.'}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {mode === 'register' && <>
          <Field label="Your name"><input className="input" value={f.name} onChange={on('name')} autoComplete="name" required /></Field>
          <Field label="Business name"><input className="input" value={f.businessName} onChange={on('businessName')} autoComplete="organization" required /></Field>
          <Field label="Website" hint="Optional — you can import it into the knowledge base later."><input className="input" value={f.website} onChange={on('website')} placeholder="https://" /></Field>
        </>}
        <Field label="Work email"><input className="input" type="email" value={f.email} onChange={on('email')} autoComplete="email" required /></Field>
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
