/**
 * Cognal brand mark. Renders the logo from /public/favicon.svg so the in-app
 * logo always matches the favicon/PWA icon.
 */
export function Logo({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/favicon.svg" alt="Cognal" className={className} />;
}
