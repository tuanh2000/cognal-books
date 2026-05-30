import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@reader/shared';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'reader-auth' },
  ),
);

interface ReaderPrefs {
  fontSize: number;
  setFontSize: (n: number) => void;
}

export const useReaderPrefs = create<ReaderPrefs>()(
  persist(
    (set) => ({
      fontSize: 100,
      setFontSize: (fontSize) => set({ fontSize: Math.min(180, Math.max(70, fontSize)) }),
    }),
    { name: 'reader-prefs' },
  ),
);
