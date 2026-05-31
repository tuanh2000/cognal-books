/**
 * Admin allow-list, sourced from the ADMIN_EMAILS env var (comma-separated).
 * Used to gate the analytics dashboard. Edge-safe (no Node/Prisma imports) so
 * it can be referenced from middleware and auth callbacks alike.
 */
export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}
