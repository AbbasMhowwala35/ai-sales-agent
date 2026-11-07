import { create } from 'zustand';

export type Toast = { id: number; kind: 'success' | 'error' | 'info'; message: string };
interface UI {
  toasts: Toast[];
  dark: boolean;
  navOpen: boolean;
  toast: (kind: Toast['kind'], message: string) => void;
  dismiss: (id: number) => void;
  toggleTheme: () => void;
  setNav: (o: boolean) => void;
}
let id = 0;
export const useUI = create<UI>((set, get) => ({
  toasts: [],
  dark: typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  navOpen: false,
  toast: (kind, message) => {
    const t = { id: ++id, kind, message };
    set({ toasts: [...get().toasts.slice(-3), t] });
    setTimeout(() => get().dismiss(t.id), kind === 'error' ? 6000 : 3500);
  },
  dismiss: (tid) => set({ toasts: get().toasts.filter((t) => t.id !== tid) }),
  toggleTheme: () => {
    const dark = !get().dark;
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
    set({ dark });
  },
  setNav: (navOpen) => set({ navOpen }),
}));
export const toast = { success: (m: string) => useUI.getState().toast('success', m), error: (m: string) => useUI.getState().toast('error', m), info: (m: string) => useUI.getState().toast('info', m) };
