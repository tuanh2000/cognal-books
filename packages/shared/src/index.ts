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

/* ──────────────────────────  Analytics (admin)  ────────────────────────── */

export interface AnalyticsDailyPoint {
  date: string; // YYYY-MM-DD
  translate: number;
  discuss: number;
  upload: number;
  login: number;
  signup: number;
  activeUsers: number;
}

export interface AnalyticsSummary {
  rangeDays: number;
  totals: { users: number; books: number; translationsCached: number; events: number };
  window: { signups: number; activeUsers: number; events: number };
  eventsByType: { type: string; count: number }[];
  topProviders: { provider: string; count: number }[];
  daily: AnalyticsDailyPoint[];
}

export type SignupMethod = 'google' | 'email';

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  lastActive: string | null;
  signupMethods: SignupMethod[];
}

export interface AdminUsersResponse {
  total: number;
  limit: number;
  offset: number;
  users: AdminUserRow[];
}

export interface AdminBookRow {
  id: string;
  title: string;
  author: string | null;
  format: BookFormat;
  fileSize: number;
  createdAt: string;
  /** Who uploaded it. */
  ownerEmail: string;
  ownerName: string | null;
}

export interface AdminBooksResponse {
  total: number;
  limit: number;
  offset: number;
  books: AdminBookRow[];
}

/* ──────────────────────────  Feedback  ────────────────────────── */

export const submitFeedbackSchema = z.object({
  message: z.string().min(1, 'Please write some feedback').max(4000),
});
export type SubmitFeedbackDto = z.infer<typeof submitFeedbackSchema>;

export interface FeedbackItem {
  id: string;
  email: string;
  message: string;
  resolved: boolean;
  createdAt: string;
}

export interface AdminFeedbackResponse {
  total: number;
  unresolved: number;
  limit: number;
  offset: number;
  items: FeedbackItem[];
}

/* ──────────────────────────  Books  ────────────────────────── */

/** Source format of a book. Drives which reader the frontend mounts. */
export const BOOK_FORMATS = ['epub', 'pdf'] as const;
export type BookFormat = (typeof BOOK_FORMATS)[number];

export interface ChapterSummary {
  id: string;
  // For EPUB: a spine href (e.g. "OEBPS/chapter1.xhtml").
  // For PDF: the 0-based destination page index, as a string.
  href: string;
  label: string;
  order: number;
}

export interface BookListItem {
  id: string;
  title: string;
  author: string | null;
  format: BookFormat;
  coverUrl: string | null;
  createdAt: string;
  progress: ReadingProgress | null;
  /** Whether the book is shared publicly (only meaningful to the owner). */
  isPublic: boolean;
  /** True when the current user owns this book (false for shared books). */
  isOwner: boolean;
  /** For shared books browsed by non-owners: who shared it. Null otherwise. */
  ownerEmail?: string | null;
}

export interface BookDetail extends BookListItem {
  language: string | null;
  fileUrl: string;
  chapters: ChapterSummary[];
}

/* ────────────────────  Reading progress  ──────────────────── */

export const progressSchema = z.object({
  bookId: z.string().uuid(),
  // Opaque location token, interpreted by the reader for the book's format.
  // EPUB: a CFI string from epub.js, e.g. "epubcfi(/6/14[chap]!/4/2/1:0)".
  // PDF: a JSON string, e.g. '{"page":12,"y":0.34}'.
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

export const SUPPORTED_TARGET_LANGS = ['vi', 'en', 'zh'] as const;
export type TargetLang = (typeof SUPPORTED_TARGET_LANGS)[number];

/** Human-readable names for each target language (UI + AI prompts). */
export const TARGET_LANG_LABELS: Record<TargetLang, string> = {
  vi: 'Vietnamese',
  en: 'English',
  zh: 'Chinese',
};

export const translateSchema = z.object({
  text: z.string().min(1).max(5000),
  targetLang: z.enum(SUPPORTED_TARGET_LANGS).default('vi'),
  bookId: z.string().uuid().optional(),
  context: z.string().max(2000).optional(),
  // Opaque location token for the selection (format-specific). EPUB: a CFI
  // range. PDF: a JSON string, e.g. '{"page":3,"start":120,"end":180}'. When
  // present with bookId, the result is saved as a SavedTranslation
  // (highlighted + reloadable from the DB).
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

/* ─────────────────────────  Discuss (summarise + Q&A)  ───────────────── */

/** One turn in a passage discussion (the system prompt is built server-side). */
export const discussMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(5000),
});
export type DiscussMessage = z.infer<typeof discussMessageSchema>;

/**
 * Ask the AI to summarise / answer questions about a selected passage. The
 * server enriches the prompt with the book's metadata (title, author) so the
 * model has context for what it is reading. The conversation is stateless: the
 * client sends the full message history each turn.
 */
export const discussSchema = z.object({
  bookId: z.string().uuid(),
  // The selected passage the discussion is about.
  text: z.string().min(1).max(8000),
  // EPUB CFI range of the selection (carried through for the UI; not required).
  cfiRange: z.string().max(2000).optional(),
  // The Q&A so far. The first message is typically an auto "summarise" prompt.
  messages: z.array(discussMessageSchema).min(1).max(40),
  // Language the assistant should reply in (defaults to Vietnamese).
  targetLang: z.enum(SUPPORTED_TARGET_LANGS).default('vi'),
});
export type DiscussDto = z.infer<typeof discussSchema>;

/** SSE event payloads streamed from POST /discuss */
export type DiscussStreamEvent =
  | { type: 'token'; value: string }
  | { type: 'done'; provider?: string }
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
