import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type { SavedTranslation, TargetLang, Translation } from '@reader/shared';
import { PrismaService } from '../prisma/prisma.service';
import { buildProviders, TranslationProvider } from './translation-providers';

const LANG_NAMES: Record<TargetLang, string> = { vi: 'Vietnamese' };

// A SMALL, illustrative sample of words to keep in English. This is NOT an
// exhaustive list — it's given to the model as examples so it can generalise to
// any similar technical/software term. Extend with TRANSLATION_KEEP_TERMS.
const KEEP_TERM_EXAMPLES = [
  'software',
  'hardware',
  'microservice',
  'framework',
  'API',
  'database',
  'frontend',
  'backend',
  'deploy',
  'container',
  'cloud',
];

function keepTermExamples(): string[] {
  const extra = (process.env.TRANSLATION_KEEP_TERMS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // De-duplicate (case-insensitive), preserving order.
  const seen = new Set<string>();
  return [...KEEP_TERM_EXAMPLES, ...extra].filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly providers: TranslationProvider[];
  // Per-provider round-robin offset, so consecutive requests start on a
  // different key and spread load across all keys of a provider.
  private readonly rotation = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {
    this.providers = buildProviders();
    if (this.providers.length === 0) {
      this.logger.warn(
        'No translation providers configured. Set at least one of: OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY.',
      );
    } else {
      this.logger.log(
        `Translation providers (in fallback order): ${this.providers
          .map(
            (p) =>
              `${p.name}(${p.model}, ${p.clients.length} key${p.clients.length > 1 ? 's' : ''})`,
          )
          .join(' → ')}`,
      );
    }
  }

  hash(text: string, targetLang: TargetLang): string {
    return createHash('sha256').update(`${text}:${targetLang}`).digest('hex');
  }

  /**
   * Look up a cached translation in SQLite (the Translation model, keyed by the
   * unique `hash`). Redis has been removed; the DB is the single cache + source
   * of truth. Best-effort: a DB error never throws, it just misses the cache.
   */
  async findCached(hash: string): Promise<Translation | null> {
    try {
      const row = await this.prisma.translation.findUnique({ where: { hash } });
      if (!row) return null;
      return {
        hash: row.hash,
        sourceText: row.sourceText,
        translatedText: row.translatedText,
        targetLang: row.targetLang as TargetLang,
        cached: true,
      };
    } catch (err) {
      this.logger.warn(`Translation cache lookup failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Stream translated tokens, trying each configured provider in priority
   * order. If a provider fails BEFORE emitting any token (quota, auth, rate
   * limit, network), it transparently falls back to the next one. A failure
   * mid-stream cannot be retried cleanly (tokens are already on the wire), so
   * it is propagated. `meta.provider` is set to the provider that served the
   * response.
   */
  async *stream(
    text: string,
    targetLang: TargetLang,
    context?: string,
    meta?: { provider?: string },
    providersOverride?: TranslationProvider[],
  ): AsyncGenerator<string> {
    // Prefer the user's own keys when provided; otherwise use the shared env keys.
    const providers =
      providersOverride && providersOverride.length > 0 ? providersOverride : this.providers;

    if (providers.length === 0) {
      throw new Error(
        'No translation provider configured. Add an OpenAI, Gemini, Groq, or OpenRouter API key.',
      );
    }

    const langName = LANG_NAMES[targetLang];
    const examples = keepTermExamples();
    const system = [
      `You are a professional translator for a software/technical audience. Translate the user's text into ${langName}.`,
      'Rules:',
      `- Produce natural, fluent ${langName} that preserves the original meaning and tone.`,
      '- Keep technical and software/IT vocabulary in English: computing and programming',
      '  terms, product and brand names, proper nouns, acronyms, and file/format names.',
      '  This is a GENERAL rule — apply it to ANY word of that kind, not only the examples',
      '  below. If a term is one that software developers normally write in English, keep it',
      '  in English even when a Vietnamese equivalent exists (e.g. do not translate "software"',
      '  to "phần mềm").',
      '- Translate only the surrounding, non-technical prose. When unsure whether a word is a',
      '  technical term, keep it in English.',
      '- Do NOT add explanations, notes, or quotation marks. Output only the translation.',
      '',
      `Examples of the kind of words to keep in English (ILLUSTRATIVE, not a complete list): ${examples.join(', ')}.`,
    ].join('\n');

    const userContent = context
      ? `Surrounding context (for disambiguation only, do not translate):\n${context}\n\nText to translate:\n${text}`
      : text;

    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: userContent },
    ];

    let lastError: unknown;
    for (const provider of providers) {
      const n = provider.clients.length;
      // Rotate the starting key for load spreading, then try every key in order.
      const start = this.rotation.get(provider.name) ?? 0;
      this.rotation.set(provider.name, (start + 1) % n);

      for (let i = 0; i < n; i++) {
        const keyIndex = (start + i) % n;
        const client = provider.clients[keyIndex];
        let emitted = false;
        try {
          const completion = await client.chat.completions.create({
            model: provider.model,
            temperature: 0.2,
            stream: true,
            messages,
          });

          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              if (!emitted) {
                emitted = true;
                if (meta) meta.provider = provider.name;
              }
              yield delta;
            }
          }
          if (meta && !meta.provider) meta.provider = provider.name;
          return; // success — done
        } catch (err) {
          lastError = err;
          this.logger.warn(
            `Provider "${provider.name}" key ${keyIndex + 1}/${n} failed${emitted ? ' mid-stream' : ''}: ${(err as Error).message}`,
          );
          // Cannot recover once tokens were sent to the client.
          if (emitted) throw err;
          // Otherwise try the next key, then the next provider.
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('All translation providers failed');
  }

  /** Persist a completed translation to SQLite (best-effort, never throws). */
  async persist(
    hash: string,
    sourceText: string,
    translatedText: string,
    targetLang: TargetLang,
  ): Promise<void> {
    try {
      await this.prisma.translation.upsert({
        where: { hash },
        create: { hash, sourceText, translatedText, targetLang },
        update: { translatedText },
      });
    } catch (err) {
      this.logger.warn(`Failed to persist translation: ${(err as Error).message}`);
    }
  }

  /* ── Saved (per-user, per-book, located) translations ── */

  /** Upsert a saved translation for a specific location in a book. */
  async saveMark(
    userId: string,
    bookId: string,
    cfiRange: string,
    sourceText: string,
    translatedText: string,
    targetLang: TargetLang,
  ): Promise<void> {
    try {
      await this.prisma.savedTranslation.upsert({
        where: { userId_bookId_cfiRange: { userId, bookId, cfiRange } },
        create: { userId, bookId, cfiRange, sourceText, translatedText, targetLang },
        update: { translatedText, sourceText },
      });
    } catch (err) {
      this.logger.warn(`Failed to save translation mark: ${(err as Error).message}`);
    }
  }

  async listMarks(userId: string, bookId: string): Promise<SavedTranslation[]> {
    const rows = await this.prisma.savedTranslation.findMany({
      where: { userId, bookId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      bookId: r.bookId,
      cfiRange: r.cfiRange,
      sourceText: r.sourceText,
      translatedText: r.translatedText,
      targetLang: r.targetLang as TargetLang,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async deleteMark(userId: string, id: string): Promise<void> {
    await this.prisma.savedTranslation.deleteMany({ where: { id, userId } });
  }
}
