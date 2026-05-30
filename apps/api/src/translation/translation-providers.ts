import OpenAI from 'openai';

/**
 * A configured translation backend. Every provider speaks the OpenAI Chat
 * Completions API (real OpenAI, or an OpenAI-compatible endpoint such as
 * Anthropic / Gemini / DeepSeek / Groq / OpenRouter). Each provider may hold
 * MULTIPLE clients — one per API key — so free-tier rate limits can be
 * multiplied by rotating keys.
 */
export interface TranslationProvider {
  name: string;
  model: string;
  clients: OpenAI[];
}

export interface ProviderDef {
  name: string;
  keyEnv: string;
  /** undefined = real OpenAI default endpoint */
  baseURL?: string;
  defaultModel: string;
  modelEnv: string;
  headers?: Record<string, string>;
}

/**
 * Canonical definition of every supported provider, keyed by the provider id
 * shared with the frontend (see AI_PROVIDERS in @reader/shared). The same map
 * powers both the shared environment keys and per-user keys.
 */
export const PROVIDER_DEFS: Record<string, ProviderDef> = {
  openai: {
    name: 'openai',
    keyEnv: 'OPENAI_API_KEY',
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    defaultModel: 'gpt-4o-mini',
    modelEnv: 'OPENAI_MODEL',
  },
  anthropic: {
    name: 'anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    // Anthropic's OpenAI-compatible endpoint.
    baseURL: 'https://api.anthropic.com/v1/',
    defaultModel: 'claude-3-5-haiku-latest',
    modelEnv: 'ANTHROPIC_MODEL',
  },
  gemini: {
    name: 'gemini',
    keyEnv: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.0-flash',
    modelEnv: 'GEMINI_MODEL',
  },
  deepseek: {
    name: 'deepseek',
    keyEnv: 'DEEPSEEK_API_KEY',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    modelEnv: 'DEEPSEEK_MODEL',
  },
  groq: {
    name: 'groq',
    keyEnv: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    modelEnv: 'GROQ_MODEL',
  },
  openrouter: {
    name: 'openrouter',
    keyEnv: 'OPENROUTER_API_KEY',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    modelEnv: 'OPENROUTER_MODEL',
    headers: { 'HTTP-Referer': 'http://localhost:8080', 'X-Title': 'Lumen Reader' },
  },
};

function makeClient(def: ProviderDef, apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: def.baseURL,
    defaultHeaders: def.headers,
    // Fail fast: don't let the SDK wait on a provider's 429 retry-after.
    // We'd rather rotate to the next key / provider immediately.
    maxRetries: 0,
  });
}

/** Parse a key env var that may hold a comma-separated list of keys. */
function parseKeys(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Builds the ordered list of providers enabled via ENVIRONMENT keys (the shared
 * fallback used when a user hasn't configured their own). Priority is controlled
 * by TRANSLATION_PROVIDER_ORDER; any provider not listed there is appended in
 * its default order. A provider is enabled when it has at least one API key.
 */
export function buildProviders(): TranslationProvider[] {
  const all = Object.values(PROVIDER_DEFS);

  const requested = (
    process.env.TRANSLATION_PROVIDER_ORDER ?? 'openai,anthropic,gemini,deepseek,groq,openrouter'
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const ordered: ProviderDef[] = [];
  const seen = new Set<string>();
  for (const name of requested) {
    const def = PROVIDER_DEFS[name];
    if (def && !seen.has(name)) {
      ordered.push(def);
      seen.add(name);
    }
  }
  for (const def of all) {
    if (!seen.has(def.name)) ordered.push(def);
  }

  const providers: TranslationProvider[] = [];
  for (const def of ordered) {
    const keys = parseKeys(process.env[def.keyEnv]);
    if (keys.length === 0) continue;
    providers.push({
      name: def.name,
      model: process.env[def.modelEnv] || def.defaultModel,
      clients: keys.map((apiKey) => makeClient(def, apiKey)),
    });
  }
  return providers;
}

export interface UserKeyEntry {
  provider: string;
  apiKey: string;
  model?: string | null;
}

/**
 * Build providers from a user's OWN stored API keys. A user may have SEVERAL
 * keys per provider; those become multiple rotating clients (same as the env
 * comma-separated keys). Order follows PROVIDER_DEFS (a sensible default
 * priority). Unknown providers and empty keys are skipped. The provider model is
 * taken from the first key that specifies one, else the provider default.
 */
export function buildUserProviders(entries: UserKeyEntry[]): TranslationProvider[] {
  const byProvider = new Map<string, UserKeyEntry[]>();
  for (const e of entries) {
    if (!e.apiKey) continue;
    const list = byProvider.get(e.provider) ?? [];
    list.push(e);
    byProvider.set(e.provider, list);
  }

  const providers: TranslationProvider[] = [];
  for (const def of Object.values(PROVIDER_DEFS)) {
    const list = byProvider.get(def.name);
    if (!list || list.length === 0) continue;
    providers.push({
      name: def.name,
      model: list.find((e) => e.model)?.model || def.defaultModel,
      clients: list.map((e) => makeClient(def, e.apiKey)),
    });
  }
  return providers;
}
