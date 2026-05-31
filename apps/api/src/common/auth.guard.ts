import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { jwtVerify } from 'jose';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { JwtUser } from './current-user.decorator';

/**
 * Verifies the short-lived HS256 access token the web app mints from its Auth.js
 * session (see apps/web /api/token). The token is signed with API_JWT_SECRET,
 * shared between the web app and this API. On success the resolved user is
 * attached to `request.user` for the @CurrentUser decorator.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly secret: Uint8Array;

  constructor(private readonly reflector: Reflector) {
    const secret = process.env.API_JWT_SECRET;
    if (!secret) {
      // Fail loud at boot rather than silently accepting nothing.
      throw new Error('API_JWT_SECRET is required to verify access tokens.');
    }
    this.secret = new TextEncoder().encode(secret);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Missing access token.');

    try {
      const { payload } = await jwtVerify(token, this.secret);
      if (!payload.sub) throw new UnauthorizedException('Token missing subject.');
      req.user = {
        id: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : '',
        isAdmin: payload.isAdmin === true,
      };
      return true;
    } catch (err) {
      this.logger.debug(`Token verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid or expired access token.');
    }
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme === 'Bearer' && value ? value : null;
  }
}
