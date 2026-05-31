import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AnalyticsSummary } from '@reader/shared';
import { PrismaService } from '../prisma/prisma.service';

export type AnalyticsEventType = 'login' | 'signup' | 'upload' | 'translate' | 'discuss';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record an event. Fire-and-forget: failures are logged but never propagate,
   * so analytics can never break a user-facing request.
   */
  log(type: AnalyticsEventType, userId: string | null, metadata?: Record<string, unknown>): void {
    this.prisma.analyticsEvent
      .create({
        data: {
          type,
          userId: userId ?? null,
          metadata: (metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      })
      .catch((err) => this.logger.warn(`Failed to log analytics event "${type}": ${err.message}`));
  }

  /** Aggregate metrics for the admin dashboard over the last `days` days. */
  async summary(days: number): Promise<AnalyticsSummary> {
    const rangeDays = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

    const [users, books, translationsCached, events] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.book.count(),
      this.prisma.translation.count(),
      this.prisma.analyticsEvent.count(),
    ]);

    const [signups, windowEvents, byTypeRows, providerRows, dailyRows, dauRows] = await Promise.all(
      [
        this.prisma.user.count({ where: { createdAt: { gte: since } } }),
        this.prisma.analyticsEvent.count({ where: { createdAt: { gte: since } } }),
        this.prisma.analyticsEvent.groupBy({
          by: ['type'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<{ provider: string; count: bigint }[]>`
        SELECT metadata->>'provider' AS provider, COUNT(*) AS count
        FROM analytics_events
        WHERE type IN ('translate', 'discuss')
          AND metadata->>'provider' IS NOT NULL
          AND "createdAt" >= ${since}
        GROUP BY provider
        ORDER BY count DESC
        LIMIT 10`,
        this.prisma.$queryRaw<{ day: Date; type: string; count: bigint }[]>`
        SELECT date_trunc('day', "createdAt")::date AS day, type, COUNT(*) AS count
        FROM analytics_events
        WHERE "createdAt" >= ${since}
        GROUP BY day, type
        ORDER BY day`,
        this.prisma.$queryRaw<{ day: Date; users: bigint }[]>`
        SELECT date_trunc('day', "createdAt")::date AS day, COUNT(DISTINCT "userId") AS users
        FROM analytics_events
        WHERE "userId" IS NOT NULL AND "createdAt" >= ${since}
        GROUP BY day
        ORDER BY day`,
      ],
    );

    const eventsByType = byTypeRows
      .map((r) => ({ type: r.type, count: r._count._all }))
      .sort((a, b) => b.count - a.count);

    const topProviders = providerRows.map((r) => ({
      provider: r.provider,
      count: Number(r.count),
    }));

    // Build a zero-filled daily series so the chart has a continuous x-axis.
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const series = new Map<string, AnalyticsSummary['daily'][number]>();
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = dayKey(d);
      series.set(key, {
        date: key,
        translate: 0,
        discuss: 0,
        upload: 0,
        login: 0,
        signup: 0,
        activeUsers: 0,
      });
    }
    for (const row of dailyRows) {
      const entry = series.get(dayKey(new Date(row.day)));
      if (entry && row.type in entry) {
        (entry as unknown as Record<string, number>)[row.type] = Number(row.count);
      }
    }
    for (const row of dauRows) {
      const entry = series.get(dayKey(new Date(row.day)));
      if (entry) entry.activeUsers = Number(row.users);
    }

    // Distinct active users across the whole window.
    const activeUsersRow = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "userId") AS count
      FROM analytics_events
      WHERE "userId" IS NOT NULL AND "createdAt" >= ${since}`;
    const activeUsers = Number(activeUsersRow[0]?.count ?? 0);

    return {
      rangeDays,
      totals: { users, books, translationsCached, events },
      window: { signups, activeUsers, events: windowEvents },
      eventsByType,
      topProviders,
      daily: Array.from(series.values()),
    };
  }
}
