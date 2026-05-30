import { Injectable } from '@nestjs/common';
import type { AddApiKeyDto, AiProvider, ApiKeySummary } from '@reader/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildUserProviders,
  type TranslationProvider,
} from '../translation/translation-providers';
import { decryptSecret, encryptSecret, maskSecret } from './crypto.util';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Masked summaries of every key the user has configured (several per provider allowed). */
  async listKeys(userId: string): Promise<ApiKeySummary[]> {
    const rows = await this.prisma.userApiKey.findMany({
      where: { userId },
      orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider as AiProvider,
      maskedKey: safeMask(r.encryptedKey),
      model: r.model,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /** Add a new key for a provider. Multiple keys per provider are allowed (rotated). */
  async addKey(userId: string, dto: AddApiKeyDto): Promise<ApiKeySummary> {
    const apiKey = dto.apiKey.trim();
    const row = await this.prisma.userApiKey.create({
      data: {
        userId,
        provider: dto.provider,
        encryptedKey: encryptSecret(apiKey),
        model: dto.model ?? null,
      },
    });
    return {
      id: row.id,
      provider: row.provider as AiProvider,
      maskedKey: maskSecret(apiKey),
      model: row.model,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Remove a single key by id (scoped to its owner). */
  async deleteKey(userId: string, id: string): Promise<void> {
    await this.prisma.userApiKey.deleteMany({ where: { id, userId } });
  }

  /**
   * Decrypt the user's stored keys and turn them into translation providers.
   * Multiple keys for the same provider become multiple rotating clients.
   * Returns an empty array when the user has configured none (callers then
   * fall back to the shared environment keys).
   */
  async buildUserProviders(userId: string): Promise<TranslationProvider[]> {
    const rows = await this.prisma.userApiKey.findMany({ where: { userId } });
    const entries = rows
      .map((r) => {
        try {
          return { provider: r.provider, apiKey: decryptSecret(r.encryptedKey), model: r.model };
        } catch {
          return null;
        }
      })
      .filter(
        (e): e is { provider: string; apiKey: string; model: string | null } => e !== null,
      );
    return buildUserProviders(entries);
  }
}

/** Decrypt just to produce a mask; never throws (shows a generic mask on error). */
function safeMask(encrypted: string): string {
  try {
    return maskSecret(decryptSecret(encrypted));
  } catch {
    return '••••';
  }
}
