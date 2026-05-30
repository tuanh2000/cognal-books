'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from './store';

/**
 * Redirects to /login when no token is present — but only AFTER the persisted
 * auth state has finished hydrating from localStorage. Without the hydration
 * gate, a hard page-load (e.g. refreshing the reader) sees the initial `null`
 * token and wrongly bounces an authenticated user to /login.
 *
 * All persist access happens inside the effect (client-only) so server
 * prerendering never touches the persist API.
 */
export function useAuthGuard() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const persist = useAuthStore.persist;
    if (!persist) {
      setHydrated(true);
      return;
    }
    if (persist.hasHydrated()) setHydrated(true);
    return persist.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (hydrated && !token) router.replace('/login');
  }, [hydrated, token, router]);

  return hydrated && !!token;
}
