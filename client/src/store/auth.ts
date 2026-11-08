import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Session {
  token: string;
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  business: { id: string; name: string; onboardingComplete: boolean };
  businesses: { id: string; name: string }[];
}
interface AuthState extends Partial<Session> {
  setSession: (s: Session) => void;
  logout: () => void;
  can: (perm: string) => boolean;
}
export const useAuth = create<AuthState>()(persist((set, get) => ({
  setSession: (s) => { window.dispatchEvent(new Event('api-mutated')); set(s); }, // new account/workspace → drop cached data
  logout: () => { window.dispatchEvent(new Event('api-mutated')); set({ token: undefined, user: undefined, business: undefined, businesses: undefined }); },
  can: (perm) => !!get().user?.permissions.includes(perm),
}), { name: 'dialstack-session', partialize: (s) => ({ token: s.token, user: s.user, business: s.business, businesses: s.businesses }) }));
