import type {
  AddApiKeyDto,
  ApiKeySummary,
  BookDetail,
  BookListItem,
  ReadingProgress,
  SavedTranslation,
  TranslateDto,
  TranslateStreamEvent,
  UpsertProgressDto,
} from '@reader/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4317/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
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
  getBook: (id: string) => request<BookDetail>(`/books/${id}`),

  uploadBook: async (file: File): Promise<BookDetail> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_URL}/books/upload`, {
      method: 'POST',
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
    const res = await fetch(`${API_URL}/books/${id}/file`);
    if (!res.ok) throw new ApiError('Failed to load book file', res.status);
    return res.arrayBuffer();
  },

  /** Fetch a cover image as an object URL. */
  getCoverObjectUrl: async (coverUrl: string): Promise<string | null> => {
    const res = await fetch(`${API_URL}${coverUrl}`);
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
    headers: { 'Content-Type': 'application/json' },
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
