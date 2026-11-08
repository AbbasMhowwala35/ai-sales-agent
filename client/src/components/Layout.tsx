import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, LayoutDashboard, Bot, Radar, Users, Megaphone, PhoneCall, BarChart3, BookOpen, Building2, ShieldCheck, Bell, Moon, Sun, LogOut, Menu, X, ChevronDown } from 'lucide-react';
import { useAuth } from '../store/auth';
import { useUI, toast } from '../store/ui';
import { useApi } from '../lib/useApi';
import { post } from '../lib/api';
import { timeAgo } from '../lib/format';
import { Avatar, cx } from './ui';

const NAV_GROUPS = [
  { label: 'Sell', items: [
    { to: '/', label: 'Today', icon: LayoutDashboard, end: true },
    { to: '/leads', label: 'Leads', icon: Users },
    { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
    { to: '/calendar', label: 'Calendar', icon: CalendarDays },
    { to: '/calls', label: 'Calls & Recordings', icon: PhoneCall },
    { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  ] },
  { label: 'Set up your agent', items: [
    { to: '/agents', label: 'AI Agents', icon: Bot },
    { to: '/lead-generation', label: 'Lead Generation', icon: Radar },
    { to: '/knowledge', label: 'Knowledge Base', icon: BookOpen },
    { to: '/settings', label: 'Business Settings', icon: Building2 },
    { to: '/team', label: 'Team & Permissions', icon: ShieldCheck },
  ] },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-5 h-16">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden><rect width="32" height="32" rx="8" fill="rgb(255 255 255 / .08)" /><path d="M7 16h3l2-6 3 12 3-9 2 3h5" fill="none" stroke="#2BC3B2" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span className="font-display text-[19px] font-[750] text-white tracking-tight">Dialstack</span>
    </div>
  );
}

function Sidebar() {
  const { navOpen, setNav } = useUI();
  const loc = useLocation();
  useEffect(() => { setNav(false); }, [loc.pathname, setNav]);
  return (
    <>
      {navOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setNav(false)} />}
      <aside className={cx('fixed z-40 inset-y-0 left-0 w-[240px] bg-nav flex flex-col transition-transform lg:translate-x-0', navOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center justify-between"><Logo /><button className="lg:hidden text-white/70 mr-3" onClick={() => setNav(false)} aria-label="Close menu"><X className="h-5 w-5" /></button></div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
          {NAV_GROUPS.map((g) => (
            <div key={g.label} className="mb-4">
              <p className="px-3 pb-1.5 pt-1 text-[12px] font-medium text-white/35">{g.label}</p>
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={(n as any).end}
                  className={({ isActive }) => cx('relative flex items-center gap-3 rounded-control px-3 h-10 text-[14px] font-medium mb-0.5', isActive ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/5')}>
                  {({ isActive }) => (<>{isActive && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[#2BC3B2]" />}<n.icon className={cx('h-[18px] w-[18px]', isActive && 'text-[#2BC3B2]')} />{n.label}</>)}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <SystemBadge />
      </aside>
    </>
  );
}

function SystemBadge() {
  const { data } = useApi<any>('/system/status');
  if (!data) return null;
  const live = data.telephony !== 'simulator';
  return (
    <div className="mx-3 mb-4 rounded-control bg-white/5 px-3 py-2.5 text-[12px] text-white/60">
      <div className="flex items-center gap-2 text-white/85 font-semibold"><span className={cx('h-2 w-2 rounded-full', live ? 'bg-[#2BC3B2] live-dot' : 'bg-white/40')} />{live ? `Calling via ${data.telephony}` : 'Simulated calling'}</div>
      <div className="mt-0.5">{data.llm.startsWith('local') ? 'Rule-based AI · add an OpenAI key for full AI' : `AI: ${data.llm}`}</div>
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const { data, reload } = useApi<any>('/notifications', { poll: 60000, staleMs: 15000 });
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  // Pop up anything new that arrived since the last check (refreshes every minute while the tab is visible).
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data?.items) return;
    if (!seen.current) { seen.current = new Set(data.items.map((n: any) => n._id)); return; }
    const fresh = data.items.filter((n: any) => !n.read && !seen.current!.has(n._id));
    fresh.slice(0, 3).reverse().forEach((n: any) => (n.type === 'error' ? toast.error : n.type === 'success' ? toast.success : toast.info)(`${n.title}${n.message ? ` — ${n.message}` : ''}`.slice(0, 140)));
    data.items.forEach((n: any) => seen.current!.add(n._id));
  }, [data]);
  useEffect(() => { const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const markAll = async () => { await post('/notifications/read', {}); reload(); };
  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost h-9 w-9 p-0 relative" onClick={() => setOpen(!open)} aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`}>
        <Bell className="h-[18px] w-[18px]" />
        {!!data?.unread && <span className="absolute top-1.5 right-1.5 min-w-4 h-4 px-1 rounded-full bg-hot text-white text-[10px] font-bold flex items-center justify-center tnum">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-[min(360px,calc(100vw-24px))] panel shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line"><span className="font-semibold">Notifications</span>{!!data?.unread && <button className="text-xs text-signal font-semibold" onClick={markAll}>Mark all read</button>}</div>
          <div className="max-h-[420px] overflow-y-auto">
            {!data?.items?.length && <p className="px-4 py-8 text-center text-muted">You’re all caught up.</p>}
            {data?.items?.map((n: any) => (
              <button key={n._id} onClick={() => { setOpen(false); post('/notifications/read', { ids: [n._id] }).then(reload); if (n.link) nav(n.link); }} className={cx('w-full text-left px-4 py-3 border-b border-line last:border-0 hover:bg-sunken', !n.read && 'bg-signal-soft/40')}>
                <div className="flex justify-between gap-2"><span className="font-semibold text-[13px] flex items-center gap-2"><span aria-hidden className={cx('h-2 w-2 rounded-full shrink-0', n.type === 'error' ? 'bg-danger' : n.type === 'warning' ? 'bg-hot' : n.type === 'success' ? 'bg-signal' : n.type === 'reminder' ? 'bg-warm' : 'bg-cold')} />{n.title}</span><span className="text-[11px] text-muted shrink-0">{timeAgo(n.createdAt)}</span></div>
                {n.message && <p className="text-[13px] text-muted line-clamp-2">{n.message}</p>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, business, businesses, logout, setSession } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const switchTo = async (id: string) => { setSession(await post('/auth/switch', { businessId: id })); location.assign('/'); };
  return (
    <div className="relative" ref={ref}>
      <button className="flex items-center gap-2 rounded-control px-1.5 py-1 hover:bg-sunken" onClick={() => setOpen(!open)} aria-haspopup="menu">
        <Avatar name={user?.name} />
        <span className="hidden sm:block text-left leading-tight"><span className="block text-[13px] font-semibold">{user?.name}</span>{business?.name && business.name !== user?.name && <span className="block text-[11px] text-muted">{business.name}</span>}</span>
        <ChevronDown className="h-4 w-4 text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-64 panel shadow-xl py-1" role="menu">
          <div className="px-4 py-2 border-b border-line"><p className="text-[13px] font-semibold">{user?.email}</p><p className="text-xs text-muted capitalize">{user?.role}</p></div>
          {businesses && businesses.length > 1 && <div className="py-1 border-b border-line">{businesses.map((b) => <button key={b.id} role="menuitem" className={cx('w-full text-left px-4 py-2 text-[13px] hover:bg-sunken', b.id === business?.id && 'font-semibold text-signal')} onClick={() => switchTo(b.id)}>{b.name}</button>)}</div>}
          <button role="menuitem" className="w-full text-left px-4 py-2 text-[13px] hover:bg-sunken flex items-center gap-2" onClick={logout}><LogOut className="h-4 w-4" />Sign out</button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { dark, toggleTheme, setNav } = useUI();
  return (
    <div className="min-h-full">
      <Sidebar />
      <div className="lg:pl-[240px] min-h-full flex flex-col">
        <header className="sticky top-0 z-20 h-16 bg-paper/90 backdrop-blur border-b border-line flex items-center gap-2 px-4 sm:px-6">
          <button className="btn-ghost h-9 w-9 p-0 lg:hidden" onClick={() => setNav(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <div className="flex-1" />
          <button className="btn-ghost h-9 w-9 p-0" onClick={toggleTheme} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}</button>
          <Notifications />
          <UserMenu />
        </header>
        <WakingBanner />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-[1320px] w-full mx-auto"><Outlet /></main>
      </div>
    </div>
  );
}

/** Shown while the free host wakes up after being idle — so a slow first load doesn't look broken. */
function WakingBanner() {
  const [on, setOn] = useState(false);
  useEffect(() => { const h = (e: Event) => setOn(!!(e as CustomEvent).detail); window.addEventListener('server-waking', h); return () => window.removeEventListener('server-waking', h); }, []);
  if (!on) return null;
  return (
    <div role="status" className="flex items-center gap-2 bg-warm/15 border-b border-warm/30 px-4 sm:px-6 lg:px-8 py-2 text-[13px]">
      <span className="h-2 w-2 rounded-full bg-warm live-dot shrink-0" />
      Starting up the server — free hosting sleeps when nobody’s used it for a while. This can take up to a minute.
    </div>
  );
}
