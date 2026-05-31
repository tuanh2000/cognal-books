import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { JwtUser } from './current-user.decorator';

/**
 * Rate-limits per authenticated user rather than per IP. Behind the nginx
 * reverse proxy every request shares one source IP, so IP-based throttling would
 * lump all users together; keying on the token subject isolates them. Falls back
 * to IP for unauthenticated (public) routes.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as JwtUser | undefined;
    if (user?.id) return `user:${user.id}`;
    const ips = req.ips as string[] | undefined;
    const ip = req.ip as string | undefined;
    return ips?.length ? ips[0] : (ip ?? 'unknown');
  }
}
