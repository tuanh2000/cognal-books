import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SUPPORTED_TARGET_LANGS, type TargetLang } from '@reader/shared';

/** How the reader lays out content: continuous scroll, or page-by-page. */
export type ReadingMode = 'scroll' | 'paginated';

interface ReaderPrefs {
  fontSize: number;
  setFontSize: (n: number) => void;
  /** Language used for AI translation and discussion replies. */
  targetLang: TargetLang;
  setTargetLang: (lang: TargetLang) => void;
  /** Scroll vs page-by-page reading. */
  readingMode: ReadingMode;
  setReadingMode: (m: ReadingMode) => void;
  toggleReadingMode: () => void;
}

export const useReaderPrefs = create<ReaderPrefs>()(
  persist(
    (set) => ({
      fontSize: 100,
      setFontSize: (fontSize) => set({ fontSize: Math.min(180, Math.max(70, fontSize)) }),
      targetLang: 'vi',
      setTargetLang: (targetLang) =>
        set({ targetLang: SUPPORTED_TARGET_LANGS.includes(targetLang) ? targetLang : 'vi' }),
      readingMode: 'scroll',
      setReadingMode: (readingMode) => set({ readingMode }),
      toggleReadingMode: () =>
        set((s) => ({ readingMode: s.readingMode === 'scroll' ? 'paginated' : 'scroll' })),
    }),
    { name: 'reader-prefs' },
  ),
);
