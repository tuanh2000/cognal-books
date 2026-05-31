import type {
  AddApiKeyDto,
  AdminBooksResponse,
  AdminFeedbackResponse,
  AdminUsersResponse,
  AnalyticsSummary,
  ApiKeySummary,
  BookDetail,
  BookListItem,
  DiscussDto,
  DiscussStreamEvent,
  ReadingProgress,
  SavedTranslation,
  TranslateDto,
  TranslateStreamEvent,
  UpsertProgressDto,
} from '@reader/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Cached access token for the NestJS API. Minted by the web app's /api/token
 * route from the Auth.js session and sent as `Authorization: Bearer`. Cached in
 * memory until shortly before it expires, then transparently re-fetched.
 */
let tokenCache: { token: string; exp: number } | null = null;

function decodeExp(token: string): number {
  try {
    const [, payload] = token.split('.');
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp : 0;
  } catch {
    return 0;
  }
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 30 > now) return tokenCache.token;

  // Same-origin call to the Next.js route; the session cookie is sent automatically.
  const res = await fetch('/api/token');
  if (!res.ok) {
    tokenCache = null;
    throw new ApiError('Not authenticated', res.status);
  }
  const { token } = (await res.json()) as { token: string };
  tokenCache = { token, exp: decodeExp(token) || now + 3600 };
  return token;
}

/** Authorization header (+ optional extras) with a fresh access token. */
async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}`, ...(extra ?? {}) };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: await authHeaders({
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  /* ── Books ── */
  listBooks: () => request<BookListItem[]>('/books'),
  listPublicBooks: () => request<BookListItem[]>('/books/public'),
  getBook: (id: string) => request<BookDetail>(`/books/${id}`),
  deleteBook: (id: string) => request<{ ok: boolean }>(`/books/${id}`, { method: 'DELETE' }),
  setBookPublic: (id: string, isPublic: boolean) =>
    request<{ ok: boolean }>(`/books/${id}/public`, {
      method: 'PATCH',
      body: JSON.stringify({ isPublic }),
    }),

  uploadBook: async (file: File, cover?: Blob | null): Promise<BookDetail> => {
    const form = new FormData();
    form.append('file', file);
    // Optional pre-rendered cover (PDF page 1); EPUB covers come from the file.
    if (cover) form.append('cover', cover, 'cover.png');
    const res = await fetch(`${API_URL}/books/upload`, {
      method: 'POST',
      headers: await authHeaders(),
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.message ?? 'Upload failed', res.status);
    }
    return res.json();
  },

  /** Fetch the raw epub as an ArrayBuffer. */
  getBookFile: async (id: string): Promise<ArrayBuffer> => {
    const res = await fetch(`${API_URL}/books/${id}/file`, { headers: await authHeaders() });
    if (!res.ok) throw new ApiError('Failed to load book file', res.status);
    return res.arrayBuffer();
  },

  /** Fetch a cover image as an object URL. */
  getCoverObjectUrl: async (coverUrl: string): Promise<string | null> => {
    const res = await fetch(`${API_URL}${coverUrl}`, { headers: await authHeaders() });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  /* ── Progress ── */
  getProgress: (bookId: string) => request<ReadingProgress | null>(`/progress/${bookId}`),
  saveProgress: (dto: UpsertProgressDto) =>
    request<ReadingProgress>('/progress', { method: 'POST', body: JSON.stringify(dto) }),

  /* ── Saved translations (per-book highlights) ── */
  listSavedTranslations: (bookId: string) =>
    request<SavedTranslation[]>(`/books/${bookId}/translations`),
  deleteSavedTranslation: (bookId: string, id: string) =>
    request<{ ok: boolean }>(`/books/${bookId}/translations/${id}`, { method: 'DELETE' }),

  /* ── Settings: per-user AI provider API keys (several per provider allowed) ── */
  listApiKeys: () => request<ApiKeySummary[]>('/settings/api-keys'),
  addApiKey: (dto: AddApiKeyDto) =>
    request<ApiKeySummary>('/settings/api-keys', { method: 'POST', body: JSON.stringify(dto) }),
  deleteApiKey: (id: string) =>
    request<{ ok: boolean }>(`/settings/api-keys/${id}`, { method: 'DELETE' }),

  /* ── Admin analytics (admin only) ── */
  getAnalytics: (days = 30) => request<AnalyticsSummary>(`/admin/analytics/summary?days=${days}`),
  getUsers: (limit = 25, offset = 0) =>
    request<AdminUsersResponse>(`/admin/analytics/users?limit=${limit}&offset=${offset}`),
  getAdminBooks: (limit = 25, offset = 0) =>
    request<AdminBooksResponse>(`/admin/analytics/books?limit=${limit}&offset=${offset}`),
  adminDeleteBook: (id: string) =>
    request<{ ok: boolean }>(`/admin/books/${id}`, { method: 'DELETE' }),

  /* ── Feedback ── */
  submitFeedback: (message: string) =>
    request<{ id: string }>('/feedback', { method: 'POST', body: JSON.stringify({ message }) }),
  getFeedback: (status: 'open' | 'resolved' | 'all' = 'all', limit = 25, offset = 0) =>
    request<AdminFeedbackResponse>(
      `/admin/feedback?status=${status}&limit=${limit}&offset=${offset}`,
    ),
  setFeedbackResolved: (id: string, resolved: boolean) =>
    request<{ ok: boolean }>(`/admin/feedback/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved }),
    }),
};

/* ── Streaming translation (SSE over POST) ── */
export async function streamTranslation(
  dto: TranslateDto,
  handlers: {
    onMeta?: (cached: boolean) => void;
    onToken?: (value: string) => void;
    onDone?: (text: string, provider?: string) => void;
    onError?: (message: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/translate`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(dto),
    signal,
  });

  if (!res.ok || !res.body) {
    handlers.onError?.(`Translation request failed (${res.status})`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let event: TranslateStreamEvent;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type === 'meta') handlers.onMeta?.(event.cached);
      else if (event.type === 'token') handlers.onToken?.(event.value);
      else if (event.type === 'done') handlers.onDone?.(event.translatedText, event.provider);
      else if (event.type === 'error') handlers.onError?.(event.message);
    }
  }
}

/* ── Streaming passage discussion (summary + Q&A, SSE over POST) ── */
export async function streamDiscuss(
  dto: DiscussDto,
  handlers: {
    onToken?: (value: string) => void;
    onDone?: (provider?: string) => void;
    onError?: (message: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/discuss`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(dto),
    signal,
  });

  if (!res.ok || !res.body) {
    handlers.onError?.(`Discussion request failed (${res.status})`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let event: DiscussStreamEvent;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type === 'token') handlers.onToken?.(event.value);
      else if (event.type === 'done') handlers.onDone?.(event.provider);
      else if (event.type === 'error') handlers.onError?.(event.message);
    }
  }
}
