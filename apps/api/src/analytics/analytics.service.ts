import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdminBooksResponse,
  AdminUsersResponse,
  AnalyticsSummary,
  BookFormat,
  SignupMethod,
} from '@reader/shared';
import { PrismaService } from '../prisma/prisma.service';

export type AnalyticsEventType =
  | 'login'
  | 'signup'
  | 'upload'
  | 'translate'
  | 'discuss'
  | 'feedback';

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

  /** Paginated user list for the admin dashboard, with signup method + last-active. */
  async listUsers(limit: number, offset: number): Promise<AdminUsersResponse> {
    const take = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
    const skip = Math.max(Math.trunc(offset) || 0, 0);

    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string;
          email: string;
          name: string | null;
          createdAt: Date;
          has_password: boolean;
          has_google: boolean;
          last_active: Date | null;
        }[]
      >`
        SELECT u.id, u.email, u.name, u."createdAt",
               (u."passwordHash" IS NOT NULL) AS has_password,
               EXISTS(
                 SELECT 1 FROM accounts a
                 WHERE a."userId" = u.id AND a.provider = 'google'
               ) AS has_google,
               (
                 SELECT MAX(e."createdAt") FROM analytics_events e
                 WHERE e."userId" = u.id
               ) AS last_active
        FROM users u
        ORDER BY u."createdAt" DESC
        LIMIT ${take} OFFSET ${skip}`,
      this.prisma.user.count(),
    ]);

    const users = rows.map((r) => {
      const signupMethods: SignupMethod[] = [];
      if (r.has_google) signupMethods.push('google');
      if (r.has_password) signupMethods.push('email');
      return {
        id: r.id,
        email: r.email,
        name: r.name,
        createdAt: r.createdAt.toISOString(),
        lastActive: r.last_active ? new Date(r.last_active).toISOString() : null,
        signupMethods,
      };
    });

    return { total, limit: take, offset: skip, users };
  }

  /** Paginated list of all uploaded books with their owner, for admins. */
  async listBooks(limit: number, offset: number): Promise<AdminBooksResponse> {
    const take = Math.min(Math.max(Math.trunc(limit) || 25, 1), 200);
    const skip = Math.max(Math.trunc(offset) || 0, 0);

    const [rows, total] = await Promise.all([
      this.prisma.book.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          title: true,
          author: true,
          format: true,
          fileSize: true,
          coverPath: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { email: true, name: true } },
        },
      }),
      this.prisma.book.count(),
    ]);

    const books = rows.map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      format: b.format as BookFormat,
      fileSize: b.fileSize,
      createdAt: b.createdAt.toISOString(),
      // Versioned by updatedAt so a freshly-set cover busts the browser cache.
      coverUrl: b.coverPath ? `/books/${b.id}/cover?v=${b.updatedAt.getTime()}` : null,
      ownerEmail: b.user.email,
      ownerName: b.user.name,
    }));

    return { total, limit: take, offset: skip, books };
  }

  /** Count a user's events of the given types since `since` (free-tier metering). */
  countUserEventsSince(userId: string, types: AnalyticsEventType[], since: Date): Promise<number> {
    return this.prisma.analyticsEvent.count({
      where: { userId, type: { in: types }, createdAt: { gte: since } },
    });
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
