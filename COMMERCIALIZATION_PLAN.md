# Cognal — Commercialization Plan

Turning the single-user **Lumen** Electron desktop app into a multi-user **Cognal** web SaaS.

- **Repo:** `git@github.com:tuanh2000/cognal-books.git` (the desktop version still lives in a separate `AI-reading-assistant` repo).
- **Stack:** pnpm monorepo — `apps/web` (Next.js 15), `apps/api` (NestJS), `packages/shared`. `apps/desktop` (Electron) is being removed.
- **Status legend:** ☐ todo · ◐ in progress · ☑ done

---

## Decisions (locked 2026-05-31)

| Topic        | Decision                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| Platform     | Remove all Electron/desktop build logic; deploy purely on the web                                                   |
| Database     | SQLite → **PostgreSQL** (repo previously ran Postgres+Redis before migrating to SQLite, so partly reversing)        |
| Branding     | **Lumen → Cognal**                                                                                                  |
| Auth         | **Auth.js (NextAuth)** in Next.js — Google OAuth + email/password registration; NestJS API trusts a verified token  |
| Analytics    | **Custom in-app admin dashboard** (events → Postgres; admin-only `/admin` page)                                     |
| Admin gating | `ADMIN_EMAILS` env var; admin = `htanh9320@gmail.com`                                                               |
| Hosting      | **Single VPS via Docker Compose** (existing `docker-compose.yml` + nginx as base)                                   |
| API keys     | Free shared Groq keys now (already dual-tier: shared env keys w/ rotation + encrypted per-user BYO keys); keep both |

---

## Architecture at a glance

```
Browser ──► Next.js 15 (apps/web)                ──► NestJS API (apps/api) ──► PostgreSQL
            • Auth.js: Google + email/password       • verifies access token     • Prisma (postgres)
            • /admin analytics dashboard             • per-user data scoping     • shared Groq keys
            • reader / library / settings            • event logging             • encrypted BYO keys
                         │                                    ▲
                         └──── signed access token (Bearer) ──┘
   nginx reverse-proxy ─ everything on one VPS via docker-compose
```

### Auth bridge (the key design point)

Auth.js owns login/session in Next.js using the **Prisma adapter against the same Postgres DB**. Because the NestJS API is a separate service, the frontend mints a short-lived **HS256 access token** (`userId`, `email`, `isAdmin`, signed with a shared `API_JWT_SECRET`) from the Auth.js session and sends it as `Authorization: Bearer` to the API. The API verifies the signature with `jose` and resolves the real user — replacing the hardcoded `local-user`. This avoids trying to decrypt Auth.js's internal JWE and is robust across Auth.js versions.

---

## Phase 0 — Strip desktop & rebrand ☑

_Low risk, reversible. Do first to make the repo a clean web project._

- ☑ Delete `apps/desktop/`, `scripts/release.sh`, `.github/workflows/release.yml`, `RELEASING.md`, `MIGRATION_PLAN.md`
- ☑ Root `package.json`: remove `desktop:*` + `release` scripts (also renamed pkg `ai-reading-assistant` → `cognal`, dropped desktop-only devDeps concurrently/cross-env/wait-on)
- ☑ `pnpm-workspace.yaml`: drop `electron` / `electron-builder` `allowBuilds` entries
- ☑ `apps/web/next.config.mjs`: `output: 'export'` → `output: 'standalone'`
- ☑ Rebrand Lumen → Cognal: `layout.tsx`, `library/page.tsx`, `site.webmanifest`, `README.md` title, `translation-providers.ts` `X-Title`. **TODO:** favicon/icon image assets still say Lumen visually — regenerate later.
- ☐ (Optional, deferred) rename `@reader/*` package scope → `@cognal/*`
- ✅ Verified: `pnpm install` clean (no electron), `@reader/web` + `@reader/api` both build.

## Phase 1 — SQLite → PostgreSQL ☐

- ☐ `apps/api/prisma/schema.prisma`: datasource `provider = "postgresql"`
- ☐ Remove the custom runtime migration runner in `apps/api/src/main.ts` (desktop-only)
- ☐ Switch to standard `prisma migrate deploy` from the API container entrypoint
- ☐ Reset migrations; generate a fresh Postgres baseline migration
- ☐ Remove `READER_DATA_DIR` / `file:` DB-URL construction; use plain `DATABASE_URL=postgresql://…`
- ☐ Keep uploads on a mounted Docker volume (revisit S3 if scaling past one box)

## Phase 2 — Auth.js (Google + email registration) ☐

- ☐ Add Auth.js + `@auth/prisma-adapter` in `apps/web`, pointed at the same Postgres
- ☐ Migrate `User` to Auth.js shape; add `Account`, `Session`, `VerificationToken`; restore `passwordHash` for Credentials; add admin flag derived from `ADMIN_EMAILS`
- ☐ Providers: Google OAuth + Credentials (email/password registration)
- ☐ Build `/auth/login` and `/auth/register` pages
- ☐ Middleware: gate `/library`, `/read`, `/settings` behind a session
- ☐ Access-token mint route + Auth.js `jwt`/`session` callbacks carrying `userId`

## Phase 3 — Wire the API to real users ☐

- ☐ `apps/web/src/lib/api.ts`: attach `Bearer` access token to every request (including SSE)
- ☐ NestJS `AuthGuard` verifies the token; `current-user.decorator.ts` returns the real user
- ☐ Delete `local-user.ts` and the bootstrap upsert in `main.ts`
- ☐ Confirm all services scope by `userId` (they already do): books, progress, translations, saved marks, API keys
- ☐ Lock CORS to the real web origin (currently allow-all)

## Phase 4 — Analytics + admin dashboard ☐

- ☐ Add `AnalyticsEvent` model (userId, type, metadata, createdAt)
- ☐ NestJS interceptor logging key events: login, upload, translate, discuss, provider/key used
- ☐ Admin-only API endpoints returning daily aggregates (DAU, translations/day, uploads, top providers, signups)
- ☐ Build `/admin` page with charts in Next.js
- ☐ Gate `/admin` on `ADMIN_EMAILS` in both the Next route and a NestJS `AdminGuard`

## Phase 5 — API-key policy for commercial use ☐

- ☐ Keep dual-tier: shared Groq env keys (free period) + encrypted per-user BYO keys (already built, takes precedence)
- ☐ Per-user rate limiting / quota on shared keys (Throttler keyed by `userId`; optional daily cap in DB)
- ☐ Settings UI copy: "Using free Cognal AI (Groq) — or add your own key"

## Phase 6 — Deployment (single VPS, Docker Compose) ☐

- ☐ Rework `docker-compose.yml`: `postgres`, `api`, `web`, `nginx` (Redis optional/removed — translation cache lives in Postgres)
- ☐ API entrypoint: `prisma migrate deploy` then start
- ☐ nginx: serve Next.js standalone + proxy `/api`, preserve SSE, raise upload limit
- ☐ Update `.env.example`: `DATABASE_URL`, `AUTH_SECRET`, `API_JWT_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `ADMIN_EMAILS`, `GROQ_API_KEY`, `NEXT_PUBLIC_API_URL`
- ☐ New README / deploy docs

---

## Open questions / out of scope (revisit)

- **Email auth style:** email **+ password** assumed. Passwordless magic-links would need an SMTP provider.
- **File storage:** local Docker volume now; S3-compatible object storage is the clean upgrade if growth demands it.
- **Legal/commercial:** Terms of Service, Privacy Policy, and billing/subscriptions not yet planned.
