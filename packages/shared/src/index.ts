import { z } from 'zod';

/* ──────────────────────────  Auth  ────────────────────────── */

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).max(120).optional(),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof loginSchema>;

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

/* ──────────────────────────  Books  ────────────────────────── */

export interface ChapterSummary {
  id: string;
  href: string;
  label: string;
  order: number;
}

export interface BookListItem {
  id: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  createdAt: string;
  progress: ReadingProgress | null;
}

export interface BookDetail extends BookListItem {
  language: string | null;
  fileUrl: string;
  chapters: ChapterSummary[];
}

/* ────────────────────  Reading progress  ──────────────────── */

export const progressSchema = z.object({
  bookId: z.string().uuid(),
  // EPUB CFI string produced by epub.js, e.g. "epubcfi(/6/14[chap]!/4/2/1:0)"
  cfi: z.string().min(1),
  percentage: z.number().min(0).max(100),
  chapterLabel: z.string().optional(),
});
export type UpsertProgressDto = z.infer<typeof progressSchema>;

export interface ReadingProgress {
  bookId: string;
  cfi: string;
  percentage: number;
  chapterLabel: string | null;
  updatedAt: string;
}

/* ─────────────────────────  Translation  ───────────────────── */

export const SUPPORTED_TARGET_LANGS = ['vi'] as const;
export type TargetLang = (typeof SUPPORTED_TARGET_LANGS)[number];

export const translateSchema = z.object({
  text: z.string().min(1).max(5000),
  targetLang: z.enum(SUPPORTED_TARGET_LANGS).default('vi'),
  bookId: z.string().uuid().optional(),
  context: z.string().max(2000).optional(),
  // EPUB CFI range of the selection. When present with bookId, the result is
  // saved as a SavedTranslation (highlighted + reloadable from the DB).
  cfiRange: z.string().max(2000).optional(),
  // Bypass the cache and re-translate, overwriting the stored result.
  force: z.boolean().optional(),
});
export type TranslateDto = z.infer<typeof translateSchema>;

/** A translation saved against a location in a book (per user). */
export interface SavedTranslation {
  id: string;
  bookId: string;
  cfiRange: string;
  sourceText: string;
  translatedText: string;
  targetLang: TargetLang;
  createdAt: string;
}

export interface Translation {
  hash: string;
  sourceText: string;
  translatedText: string;
  targetLang: TargetLang;
  cached: boolean;
}

/** SSE event payloads streamed from POST /translate */
export type TranslateStreamEvent =
  | { type: 'meta'; hash: string; cached: boolean }
  | { type: 'token'; value: string }
  | { type: 'done'; translatedText: string; provider?: string }
  | { type: 'error'; message: string };

/* ─────────────────  AI provider settings (per-user API keys)  ───────────────── */

// The AI platforms a user can supply their own API key for. Every provider is
// reached through the OpenAI-compatible Chat Completions API on the backend.
export const AI_PROVIDERS = ['openai', 'anthropic', 'gemini', 'deepseek', 'groq'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface AiProviderInfo {
  id: AiProvider;
  label: string;
  /** Used when the user doesn't override the model. */
  defaultModel: string;
  /** Hint shown in the key input. */
  keyPlaceholder: string;
  /** Where to get a key. */
  consoleUrl: string;
}

export const AI_PROVIDER_INFO: Record<AiProvider, AiProviderInfo> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    keyPlaceholder: 'sk-...',
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-3-5-haiku-latest',
    keyPlaceholder: 'sk-ant-...',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    keyPlaceholder: 'AIza...',
    consoleUrl: 'https://aistudio.google.com/apikey',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    keyPlaceholder: 'sk-...',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    keyPlaceholder: 'gsk_...',
    consoleUrl: 'https://console.groq.com/keys',
  },
};

export const addApiKeySchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  apiKey: z.string().min(8, 'API key looks too short').max(400),
  model: z.string().min(1).max(120).optional(),
});
export type AddApiKeyDto = z.infer<typeof addApiKeySchema>;

/**
 * Safe view of a stored key — the raw key is never returned to the client.
 * A user may store several keys for the same provider (e.g. to rotate across
 * multiple free-tier keys for a higher combined limit), so each has its own id.
 */
export interface ApiKeySummary {
  id: string;
  provider: AiProvider;
  /** Masked for display, e.g. "••••AB12". */
  maskedKey: string;
  model: string | null;
  updatedAt: string;
}
