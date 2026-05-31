import { Injectable } from '@nestjs/common';
import type { AdminFeedbackResponse, FeedbackItem } from '@reader/shared';
import { PrismaService } from '../prisma/prisma.service';

type StatusFilter = 'open' | 'resolved' | 'all';

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create a feedback entry (email comes from the authenticated user). */
  create(userId: string, email: string, message: string): Promise<{ id: string }> {
    return this.prisma.feedback.create({
      data: { userId, email, message: message.trim() },
      select: { id: true },
    });
  }

  /** Admin: paginated feedback list (+ unresolved count for the badge). */
  async list(status: StatusFilter, limit: number, offset: number): Promise<AdminFeedbackResponse> {
    const take = Math.min(Math.max(Math.trunc(limit) || 25, 1), 100);
    const skip = Math.max(Math.trunc(offset) || 0, 0);
    const where =
      status === 'open' ? { resolved: false } : status === 'resolved' ? { resolved: true } : {};

    const [rows, total, unresolved] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        orderBy: [{ resolved: 'asc' }, { createdAt: 'desc' }],
        take,
        skip,
      }),
      this.prisma.feedback.count({ where }),
      this.prisma.feedback.count({ where: { resolved: false } }),
    ]);

    const items: FeedbackItem[] = rows.map((r) => ({
      id: r.id,
      email: r.email,
      message: r.message,
      resolved: r.resolved,
      createdAt: r.createdAt.toISOString(),
    }));

    return { total, unresolved, limit: take, offset: skip, items };
  }

  /** Admin: mark resolved / reopen. */
  async setResolved(id: string, resolved: boolean): Promise<{ ok: boolean }> {
    await this.prisma.feedback.update({ where: { id }, data: { resolved } });
    return { ok: true };
  }
}
