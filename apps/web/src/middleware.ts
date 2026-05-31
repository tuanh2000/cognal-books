import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

// Build an edge-safe auth instance from the base config (no Prisma/bcrypt). The
// `authorized` callback in authConfig decides which routes require a session.
export const { auth: middleware } = NextAuth(authConfig);

export default middleware((req) => {
  // The authorized() callback handles allow/deny + redirects; nothing else here.
  void req;
});

export const config = {
  // Run on everything except Next internals, the auth API, and static assets.
  matcher: [
    '/((?!api/auth|api/register|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webmanifest|js|css|map)$).*)',
  ],
};
