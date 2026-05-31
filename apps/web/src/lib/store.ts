import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SUPPORTED_TARGET_LANGS, type TargetLang } from '@reader/shared';

interface ReaderPrefs {
  fontSize: number;
  setFontSize: (n: number) => void;
  /** Language used for AI translation and discussion replies. */
  targetLang: TargetLang;
  setTargetLang: (lang: TargetLang) => void;
}

export const useReaderPrefs = create<ReaderPrefs>()(
  persist(
    (set) => ({
      fontSize: 100,
      setFontSize: (fontSize) => set({ fontSize: Math.min(180, Math.max(70, fontSize)) }),
      targetLang: 'vi',
      setTargetLang: (targetLang) =>
        set({ targetLang: SUPPORTED_TARGET_LANGS.includes(targetLang) ? targetLang : 'vi' }),
    }),
    { name: 'reader-prefs' },
  ),
);
