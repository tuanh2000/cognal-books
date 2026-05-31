import type { NextAuthConfig } from 'next-auth';
import { isAdminEmail } from '@/lib/admin';

/**
 * Edge-safe Auth.js config. Contains NO database/bcrypt imports so it can run in
 * the middleware (edge) runtime. The full config in `auth.ts` spreads this and
 * adds the Prisma adapter + providers (Node runtime only).
 */

// Routes that require a signed-in user.
const PROTECTED_PREFIXES = ['/library', '/read', '/settings', '/admin'];
// Admin-only routes (in addition to requiring sign-in).
const ADMIN_PREFIXES = ['/admin'];

export const authConfig = {
  pages: {
    signIn: '/auth/login',
  },
  session: { strategy: 'jwt' },
  callbacks: {
    // Gatekeeper used by the middleware. Return false → redirect to signIn page.
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = !!auth?.user;
      const isAdmin = !!auth?.user?.isAdmin;

      if (ADMIN_PREFIXES.some((p) => pathname.startsWith(p))) {
        return isLoggedIn && isAdmin;
      }
      if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
        return isLoggedIn;
      }
      // Bounce signed-in users away from the auth pages.
      if (pathname.startsWith('/auth') && isLoggedIn) {
        return Response.redirect(new URL('/library', request.nextUrl));
      }
      return true;
    },
    // Carry the user id + admin flag on the JWT so they're available everywhere
    // (incl. the edge middleware) without a DB round-trip.
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
      }
      token.isAdmin = isAdminEmail(token.email);
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.isAdmin = !!token.isAdmin;
      }
      return session;
    },
  },
  // Providers are added in auth.ts (they pull in Prisma/bcrypt — not edge-safe).
  providers: [],
} satisfies NextAuthConfig;

export default authConfig;
