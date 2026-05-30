import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Thin wrapper around ioredis. Used as the translation cache layer.
 * Failures are logged but never throw — the cache is best-effort, the
 * database remains the source of truth.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    this.client.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.warn(`Redis GET failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Set with a TTL (default 30 days). */
  async set(key: string, value: string, ttlSeconds = 60 * 60 * 24 * 30): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`Redis SET failed: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}
