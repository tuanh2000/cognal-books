import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface JwtUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

/**
 * Resolves the authenticated user attached to the request by AuthGuard (which
 * verifies the Bearer access token minted by the web app's Auth.js session).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    if (!req.user) {
      // Should never happen when AuthGuard runs first; guards against misuse.
      throw new Error('No authenticated user on request (is AuthGuard active?).');
    }
    return req.user;
  },
);
