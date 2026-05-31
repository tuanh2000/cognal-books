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

## Phase 1 — SQLite → PostgreSQL ☑

- ☑ `apps/api/prisma/schema.prisma`: datasource `provider = "postgresql"`; `binaryTargets = ["native"]`
- ☑ Remove the custom runtime migration runner in `apps/api/src/main.ts` (desktop-only)
- ☑ Migrations applied via `prisma migrate deploy` (already in `apps/api/Dockerfile` CMD); local dev uses `prisma migrate dev`
- ☑ Reset migrations; generated fresh Postgres baseline `20260531_init` (lock → postgresql)
- ☑ Removed `READER_DATA_DIR` / `file:` DB-URL construction (`paths.ts` now only resolves `UPLOAD_DIR`); `main.ts` reads `DATABASE_URL` from env, binds `0.0.0.0:4000`, wires `CORS_ORIGINS`
- ☑ Uploads stay on a mounted Docker volume (`UPLOAD_DIR=/data/uploads`)
- ☑ Rewrote `apps/api/.env.example` for Postgres/web mode
- ✅ Verified end-to-end: against a throwaway Postgres 16, migration applied, API booted, `GET /api/books` → `200 []`, local-user row created.

## Phase 2 — Auth.js (Google + email registration) ☑

- ☑ Added `next-auth@5` (beta.31) + `@auth/prisma-adapter`, `@prisma/client`, `bcryptjs`, `jose` in `apps/web` (`lib/prisma.ts` singleton, same Postgres)
- ☑ Extended `User` (optional `passwordHash`, `emailVerified`, `image`) + added `Account`, `Session`, `VerificationToken`; refreshed the baseline migration (10 tables); admin derived from `ADMIN_EMAILS` (`lib/admin.ts`)
- ☑ Providers: Google OAuth (`allowDangerousEmailAccountLinking`) + Credentials (email/password); `/api/register` route hashes with bcrypt (cost 12)
- ☑ `/auth/login` + `/auth/register` pages (Google button + email form), sign-out + admin link in library header, `SessionProvider` in providers
- ☑ Edge-safe middleware via **split config** (`auth.config.ts` for edge / `auth.ts` with adapter for Node) gating `/library`, `/read`, `/settings`, `/admin`
- ☑ `GET /api/token` mints a short-lived HS256 access token (`sub`,`email`,`isAdmin`) signed with `API_JWT_SECRET`; `jwt`/`session` callbacks carry `id`+`isAdmin`
- ☑ Updated `apps/web/.env.example` (`AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`, `API_JWT_SECRET`, `ADMIN_EMAILS`, `AUTH_TRUST_HOST`, `DATABASE_URL`)
- ✅ Verified end-to-end (against Postgres): web build incl. all auth routes + edge middleware; register→CSRF→credentials login→session (`isAdmin:true`)→token mint; minted JWT verifies with shared secret (and rejects a wrong one); password stored as bcrypt `$2b$12$`.
- ⚠️ Live **Google OAuth** not e2e-tested here (needs real client id/secret + browser redirect); provider is wired per Auth.js v5 conventions.

## Phase 3 — Wire the API to real users ☑

- ☑ `apps/web/src/lib/api.ts`: fetches a token from `/api/token` (cached until ~30s before expiry), attaches `Bearer` to every call incl. upload, file/cover fetch, and both SSE streams
- ☑ NestJS global `AuthGuard` (`jose` HS256, `API_JWT_SECRET`) verifies the token and attaches the user; `@Public()` decorator + `GET /api/health` exempt; `current-user.decorator.ts` now returns the real user (`id`,`email`,`isAdmin`)
- ☑ Deleted `local-user.ts` and the bootstrap upsert; `main.ts` now requires `API_JWT_SECRET` at boot
- ☑ All services already scope by `userId` — unchanged, now driven by the real token subject
- ☑ CORS already restricted via `CORS_ORIGINS` (Phase 1)
- ✅ Verified against Postgres: `/api/health` public 200; no-token / malformed / wrong-secret JWT → 401; valid token → 200; API refuses to boot without `API_JWT_SECRET`.
- ⚠️ **Deployment note (for Phase 6 nginx):** the web app owns `/api/auth/*`, `/api/register`, `/api/token`; the Nest API owns the other `/api/*`. nginx must route the three Next-owned prefixes to `web` _before_ the catch-all `/api/ → api`. (In non-Docker dev there's no conflict: web=:3000, API=:4000.)

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
