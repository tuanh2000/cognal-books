import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

type WebAnalyticsEventType = 'login' | 'signup';

/**
 * Server-side analytics logging for events that happen in the web app (auth).
 * Fire-and-forget: failures are swallowed so they never break sign-in/sign-up.
 * Usage events (translate/discuss/upload) are logged by the NestJS API.
 */
export function logEvent(
  type: WebAnalyticsEventType,
  userId: string | null,
  metadata?: Record<string, unknown>,
): void {
  prisma.analyticsEvent
    .create({
      data: {
        type,
        userId: userId ?? null,
        metadata: (metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    })
    .catch((err) => console.warn(`[analytics] failed to log "${type}":`, err?.message));
}
