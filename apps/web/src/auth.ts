import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { loginSchema } from '@reader/shared';
import { prisma } from '@/lib/prisma';
import { authConfig } from '@/auth.config';

/**
 * Full Auth.js config (Node runtime). Spreads the edge-safe base config and adds
 * the Prisma adapter + providers.
 *
 * - Google: standard OAuth; the adapter creates the User + Account rows.
 * - Credentials: email/password sign-in. Users are created by /api/register
 *   (this only verifies). Credentials REQUIRES the JWT session strategy.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      // Let an existing email/password account link to Google on first OAuth
      // sign-in with the same verified email.
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
        });
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
});
