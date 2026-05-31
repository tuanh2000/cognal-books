import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtUser } from './current-user.decorator';

/**
 * Allows only admin users (token `isAdmin` claim, derived from ADMIN_EMAILS in
 * the web app). Must run after AuthGuard, which populates `request.user`.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    if (!req.user?.isAdmin) {
      throw new ForbiddenException('Admin access required.');
    }
    return true;
  }
}
