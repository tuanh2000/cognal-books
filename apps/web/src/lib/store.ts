import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
