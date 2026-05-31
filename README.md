# Cognal — AI Reading Assistant

A multi-user web app for reading EPUBs and PDFs. Highlight any passage and stream
a natural translation (Vietnamese / English / Chinese) in real time, or "discuss"
a passage with an AI reading assistant. Translations are cached in Postgres so
repeated lookups are instant and free.

Users sign in with Google or email/password. Translation runs on a shared free
provider (Groq) with a fair-use daily limit; users can add their own API keys to
remove the limit. An admin-only dashboard shows traffic and usage analytics.

> Cognal is the web/SaaS evolution of the former **Lumen** desktop app. See
> `COMMERCIALIZATION_PLAN.md` for the migration history and architecture notes.

---

## Tech stack

| Layer        | Tech                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| **Frontend** | Next.js 15 (App Router) · React 19 · TypeScript · TailwindCSS · EPUB.js · pdf.js · Zustand · TanStack Query |
| **Auth**     | Auth.js (NextAuth v5) — Google OAuth + email/password (Credentials) · Prisma adapter                        |
| **Backend**  | NestJS · TypeScript · Prisma · PostgreSQL · OpenAI-compatible provider SDK                                  |
| **Infra**    | Docker · Docker Compose · Nginx (reverse proxy + SSE passthrough)                                           |
| **Monorepo** | pnpm workspaces (`apps/web`, `apps/api`, `packages/shared`)                                                 |

---

## Architecture

```
                         ┌──────────────────────────┐
   Browser  ──HTTP/SSE──▶│         Nginx :8080       │
                         │  /api/auth, /api/register, │
                         │  /api/token   → web        │   (Auth.js + token mint)
                         │  /api/...     → api        │   (buffering off → SSE)
                         │  /            → web        │
                         └─────────────┬─────────────┘
                          ┌────────────┴────────────┐
                  ┌───────▼───────┐         ┌────────▼────────┐
                  │   web :3000   │         │    api :4000     │
                  │  Next.js SSR  │         │   NestJS REST    │
                  │  + Auth.js    │         │  + AuthGuard     │
                  └───────┬───────┘         └────────┬─────────┘
                          │   signed access token     │
                          └─────────(Bearer)──────────┘
                                       │
                              ┌────────▼────────┐
                              │  Postgres :5432  │   (Prisma — shared by web + api)
                              └──────────────────┘
                                       + AI provider APIs (streaming translation)
```

### Auth bridge

Auth.js owns login/session in the Next.js app (Google + email/password) using the
Prisma adapter on the shared Postgres. Because the API is a separate service, the
web app mints a short-lived **HS256 access token** (`sub`=userId, `email`,
`isAdmin`) from the session at `GET /api/token`, signed with `API_JWT_SECRET`. The
browser sends it as `Authorization: Bearer` on every API call; the API's
`AuthGuard` verifies it and resolves the user. `API_JWT_SECRET` must match on both
services.

> nginx routes the **web-owned** paths (`/api/auth/*`, `/api/register`,
> `/api/token`) to the Next.js app and everything else under `/api/` to NestJS.

### Backend modules

```
apps/api/src/
├── analytics/    event logging + admin-only aggregate endpoints
├── books/        upload, validation, storage, metadata, file serving
├── reader/       reading-progress upsert/fetch
├── translation/  SHA256 cache + multi-provider SSE streaming (translate + discuss)
├── parsers/      EbookParser interface + Epub/Pdf parsers + registry
├── settings/     per-user encrypted AI provider keys
├── prisma/       PrismaService (global)
├── health/       public health check
└── common/       AuthGuard, AdminGuard, UserThrottlerGuard, @CurrentUser, @Public
```

---

## Quick start (Docker — one command)

Requires Docker + Docker Compose.

```bash
cp .env.example .env
#   set strong secrets: AUTH_SECRET (openssl rand -base64 32), API_JWT_SECRET,
#   APP_ENCRYPTION_KEY; set GROQ_API_KEY for free AI; optionally AUTH_GOOGLE_ID/
#   AUTH_GOOGLE_SECRET for Google sign-in. ADMIN_EMAILS gates /admin.

docker compose up --build
```

Then open **http://localhost:8080**. Migrations run automatically on API start
(`prisma migrate deploy`).

| Service  | URL / port            |
| -------- | --------------------- |
| App      | http://localhost:8080 |
| API      | proxied at `/api`     |
| Postgres | internal `5432`       |

> For Google OAuth, add `http://localhost:8080/api/auth/callback/google` as an
> authorized redirect URI in the Google Cloud console (use your real domain in
> production, and set `AUTH_URL` accordingly).

---

## Local development (without Docker)

Start Postgres (e.g. `docker compose up postgres`, which publishes `5432`), then:

```bash
pnpm install

# 1. shared package (built once; consumed by api + web)
pnpm --filter @reader/shared build

# 2. API  (http://localhost:4000)
cp apps/api/.env.example apps/api/.env   # set DATABASE_URL, API_JWT_SECRET, APP_ENCRYPTION_KEY
pnpm --filter @reader/api exec prisma migrate dev
pnpm --filter @reader/api dev

# 3. Web  (http://localhost:3000, new terminal)
cp apps/web/.env.example apps/web/.env.local
#   set DATABASE_URL, AUTH_SECRET, API_JWT_SECRET (== API), ADMIN_EMAILS,
#   NEXT_PUBLIC_API_URL=http://localhost:4000/api
pnpm --filter @reader/web dev
```

Or run both apps at once from the repo root: `pnpm dev`.

> In local dev there's no nginx, so no route conflict: the web app is on `:3000`
> (Auth.js + `/api/token`) and the API is on `:4000`.

---

## API reference

Authenticated requests use `Authorization: Bearer <accessToken>` (from
`GET /api/token`). Auth endpoints below are served by the web app.

| Method          | Endpoint                       | Auth    | Description                              |
| --------------- | ------------------------------ | ------- | ---------------------------------------- |
| POST            | `/api/register`                | —       | Email/password sign-up (web)             |
| \*              | `/api/auth/*`                  | —       | Auth.js (login, callback, session) (web) |
| GET             | `/api/token`                   | session | Mint an API access token (web)           |
| GET             | `/api/health`                  | —       | Health check (api)                       |
| POST            | `/api/books/upload`            | ✓       | Multipart `file` (.epub/.pdf)            |
| GET             | `/api/books`                   | ✓       | List the user's books (+ progress)       |
| GET             | `/api/books/:id`               | ✓       | Book detail + chapters                   |
| GET             | `/api/books/:id/file`          | ✓       | Raw book file (for the reader)           |
| GET             | `/api/books/:id/cover`         | ✓       | Cover image                              |
| POST            | `/api/translate`               | ✓       | SSE stream of the translation            |
| POST            | `/api/discuss`                 | ✓       | SSE stream of a passage discussion       |
| POST            | `/api/progress`                | ✓       | Upsert reading progress                  |
| GET             | `/api/progress/:bookId`        | ✓       | Fetch reading progress                   |
| GET/POST/DELETE | `/api/settings/api-keys`       | ✓       | Manage per-user AI provider keys         |
| GET             | `/api/admin/analytics/summary` | admin   | Traffic + usage aggregates               |

---

## Translation providers

Translation needs at least one provider key. The service tries providers in the
order given by `TRANSLATION_PROVIDER_ORDER` and **falls back** to the next when one
fails (quota / auth / rate-limit / network) before any token streams. A provider is
enabled only when its key is set. All endpoints are OpenAI-compatible.

| Provider   | Key env              | Free tier?               | Default model                            | Sign up                            |
| ---------- | -------------------- | ------------------------ | ---------------------------------------- | ---------------------------------- |
| Gemini     | `GEMINI_API_KEY`     | ✅ generous, no card     | `gemini-2.0-flash`                       | https://aistudio.google.com/apikey |
| Groq       | `GROQ_API_KEY`       | ✅ (rate-limited)        | `llama-3.3-70b-versatile`                | https://console.groq.com/keys      |
| OpenRouter | `OPENROUTER_API_KEY` | ✅ free models (`:free`) | `meta-llama/llama-3.3-70b-instruct:free` | https://openrouter.ai/keys         |
| OpenAI     | `OPENAI_API_KEY`     | ❌ paid (prepaid)        | `gpt-4o-mini`                            | https://platform.openai.com        |

**Two tiers of keys.** Shared keys come from the env above (the free Cognal AI —
set `GROQ_API_KEY`). Each user may also add their own keys in Settings; those are
encrypted at rest (AES-256-GCM) and take precedence. Users on shared keys are
capped at `FREE_DAILY_LIMIT` translate+discuss calls per 24h (`0` disables it);
users with their own keys are never limited.

**Multiple keys per provider.** Any `*_API_KEY` may be a comma-separated list to
multiply a free tier's rate limit (round-robin, with fall-through on `429`).

The UI shows which provider served each translation (a "via gemini" badge), or
"cached" when it came from Postgres.

---

## Security

- **Auth:** Auth.js sessions (Google + bcrypt email/password); the API verifies a
  signed access token on every request via a global `AuthGuard`; books/progress/keys
  are scoped to the owning user. Admin routes require an `ADMIN_EMAILS` match.
- **Rate limiting:** per-user throttler (keyed on the token subject, not IP) +
  the free-tier daily AI cap.
- **Upload validation:** extension + MIME filter, size limit (`MAX_UPLOAD_MB`), and
  a structural ZIP/EPUB signature check before parsing.
- **Request validation:** every body is parsed through a Zod schema.
- **Secrets** via environment variables; `.env` is git-ignored. User AI keys are
  encrypted with `APP_ENCRYPTION_KEY`.

---

## Project layout

```
.
├── apps/
│   ├── api/            NestJS backend (+ Prisma schema, Dockerfile)
│   └── web/            Next.js frontend + Auth.js (App Router, Dockerfile)
├── packages/
│   └── shared/         Zod DTOs + shared TypeScript types
├── nginx/nginx.conf    Reverse proxy (route split + SSE passthrough)
├── docker-compose.yml
├── COMMERCIALIZATION_PLAN.md
└── .env.example
```

---

## Adding a new format later

1. `apps/api/src/parsers/<fmt>/<fmt>.parser.ts` implementing `EbookParser`
   (`extensions`, `validate`, `parse`).
2. Register it in `ParserRegistry`'s constructor.

No controller, service, schema, or frontend change required for ingestion.
