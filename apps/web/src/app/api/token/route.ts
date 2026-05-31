import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { auth } from '@/auth';

/**
 * Mint a short-lived HS256 access token for the NestJS API from the current
 * Auth.js session. The browser attaches this as `Authorization: Bearer <token>`
 * on API calls; the API verifies it with the shared API_JWT_SECRET. This bridges
 * the Next.js session to the separate API service without sharing Auth.js's
 * internal (encrypted) session token.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const secret = process.env.API_JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server auth not configured.' }, { status: 500 });
  }

  const token = await new SignJWT({
    email: session.user.email ?? undefined,
    isAdmin: !!session.user.isAdmin,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.user.id)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));

  return NextResponse.json({ token });
}
