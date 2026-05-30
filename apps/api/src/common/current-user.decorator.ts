import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { LOCAL_USER_ID, LOCAL_USER_EMAIL } from './local-user';

export interface JwtUser {
  id: string;
  email: string;
}

/**
 * Resolves the current user. Auth has been removed for the local-only desktop
 * app: every request maps to the single local user (LOCAL_USER_ID), regardless
 * of the request. Controllers keep their user-scoping logic intact — it now
 * always scopes to the local user.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): JwtUser => {
    return { id: LOCAL_USER_ID, email: LOCAL_USER_EMAIL };
  },
);
