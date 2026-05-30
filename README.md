# Lumen — AI-Assisted EPUB Reader

Upload EPUBs, read them in a clean distraction-free reader, highlight any passage,
and stream a natural Vietnamese translation in real time. Translations are cached
(Redis + Postgres) so repeated lookups are instant and free.

> **MVP scope:** `.epub` only. The parser layer is designed so PDF/MOBI/AZW3 can be
> added later without touching the rest of the codebase.

---

## Tech stack

| Layer        | Tech                                                                  |
| ------------ | --------------------------------------------------------------------- |
| **Frontend** | Next.js (App Router) · TypeScript · TailwindCSS · EPUB.js · Zustand · TanStack Query · shadcn-style UI |
| **Backend**  | NestJS · TypeScript · Prisma · PostgreSQL · Redis · OpenAI SDK        |
| **Infra**    | Docker · Docker Compose · Nginx (reverse proxy + SSE passthrough)     |
| **Monorepo** | pnpm workspaces (`apps/web`, `apps/api`, `packages/shared`)           |

---

## Architecture

```
                         ┌──────────────────────────┐
   Browser  ──HTTP/SSE──▶│         Nginx :8080       │
                         │  /        → web (Next.js)  │
                         │  /api/    → api (NestJS)   │  (buffering off → SSE)
                         └─────────────┬─────────────┘
                          ┌────────────┴────────────┐
                  ┌───────▼───────┐         ┌────────▼────────┐
                  │   web :3000   │         │    api :4000     │
                  │  Next.js SSR  │         │   NestJS REST    │
                  └───────────────┘         └───┬─────────┬────┘
                                                │         │
                                  ┌─────────────▼──┐  ┌───▼──────────┐
                                  │  Postgres :5432 │  │  Redis :6379 │
                                  │  (Prisma)       │  │  (tx cache)  │
                                  └─────────────────┘  └──────────────┘
                                  + OpenAI API (streaming translation)
```

### Key decisions

- **`packages/shared`** holds all DTOs as Zod schemas + inferred TypeScript types.
  The API validates requests against the same schemas the web app uses — one source of truth.
- **Thin backend for reading.** The API only extracts metadata (title/author/cover/chapters)
  and stores the raw `.epub`. EPUB.js on the client fetches the file as an `ArrayBuffer`
  (auth header attached) and renders it — keeping pagination/rendering smooth and local.
- **Parser extensibility.** `parsers/interfaces/ebook-parser.interface.ts` defines the
  contract; `parsers/epub/epub.parser.ts` implements it; `ParserRegistry` resolves by
  extension. Adding PDF later = one new class + one registry line.
- **Translation caching.** `SHA256(text + ':' + lang)` → check Redis → check Postgres
  (and warm Redis) → otherwise stream from a provider, then persist to both. Cache hits
  replay instantly through the same SSE channel.
- **Multi-provider with fallback.** The translator tries providers in a configured
  priority order (`TRANSLATION_PROVIDER_ORDER`) and transparently falls back to the
  next when one fails before streaming any token (quota / auth / rate-limit / network).
  All providers are OpenAI-compatible, so one client type covers OpenAI, Gemini, Groq,
  and OpenRouter — enable any by setting its API key. See **Translation providers** below.
- **Streaming.** `POST /api/translate` responds `text/event-stream`; Nginx disables
  proxy buffering on `/api/` so tokens reach the browser as they're produced.

### Backend modules

```
src/
├── auth/         email+password, bcrypt, JWT (Passport)
├── books/        upload, validation, storage, metadata, file serving
├── reader/       reading-progress upsert/fetch
├── translation/  SHA256 cache + multi-provider SSE streaming (with fallback)
├── parsers/      EbookParser interface + EpubParser + registry
├── prisma/       PrismaService (global)
├── redis/        RedisService cache wrapper (global)
└── common/       Zod validation pipe, @CurrentUser decorator
```

---

## Quick start (Docker — one command)

Requires Docker + Docker Compose.

```bash
cp .env.example .env
#   edit .env and set OPENAI_API_KEY (and a strong JWT_SECRET)

docker compose up --build
```

Then open **http://localhost:8080**. Migrations run automatically on API start.

| Service  | URL / port               |
| -------- | ------------------------ |
| App      | http://localhost:8080    |
| API      | proxied at `/api`        |
| Postgres | internal `5432`          |
| Redis    | internal `6379`          |

---

## Local development (without Docker)

You need local Postgres + Redis running (or just start those two via compose:
`docker compose up postgres redis`).

```bash
pnpm install

# 1. shared package (built once; consumed by api + web)
pnpm --filter @reader/shared build

# 2. API
cp apps/api/.env.example apps/api/.env   # set OPENAI_API_KEY, DATABASE_URL, REDIS_URL
pnpm --filter @reader/api exec prisma migrate dev
pnpm --filter @reader/api dev            # http://localhost:4000

# 3. Web (new terminal)
cp apps/web/.env.example apps/web/.env.local   # NEXT_PUBLIC_API_URL=http://localhost:4000/api
pnpm --filter @reader/web dev            # http://localhost:3000
```

Or run both apps at once from the repo root: `pnpm dev`.

---

## API reference

| Method | Endpoint                | Auth | Description                              |
| ------ | ----------------------- | ---- | ---------------------------------------- |
| POST   | `/api/auth/register`    | —    | Create account → `{ accessToken, user }` |
| POST   | `/api/auth/login`       | —    | Log in → `{ accessToken, user }`         |
| GET    | `/api/auth/me`          | ✓    | Current user                             |
| POST   | `/api/books/upload`     | ✓    | Multipart `file` (.epub) → `BookDetail`  |
| GET    | `/api/books`            | ✓    | List user's books (+ progress)           |
| GET    | `/api/books/:id`        | ✓    | Book detail + chapters                   |
| GET    | `/api/books/:id/file`   | ✓    | Raw `.epub` stream (for EPUB.js)         |
| GET    | `/api/books/:id/cover`  | ✓    | Cover image                              |
| POST   | `/api/translate`        | ✓    | SSE stream of Vietnamese translation     |
| GET    | `/api/translations/:hash` | ✓  | Cached translation lookup                |
| POST   | `/api/progress`         | ✓    | Upsert reading progress                  |
| GET    | `/api/progress/:bookId` | ✓    | Fetch reading progress                   |

Authenticated requests use `Authorization: Bearer <accessToken>`.

---

## Translation providers

Translation needs at least one provider key. The service tries providers in the
order given by `TRANSLATION_PROVIDER_ORDER` and **falls back to the next one** if a
provider fails (out of quota, bad key, rate-limited, network error) before any token
streams. A provider is enabled only when its key is set — so just add a key to turn
it on. All endpoints below are OpenAI-compatible.

| Provider   | Key env              | Free tier?            | Default model                              | Sign up |
| ---------- | -------------------- | --------------------- | ------------------------------------------ | ------- |
| Gemini     | `GEMINI_API_KEY`     | ✅ generous, no card   | `gemini-2.0-flash`                         | https://aistudio.google.com/apikey |
| Groq       | `GROQ_API_KEY`       | ✅ (rate-limited)      | `llama-3.3-70b-versatile`                  | https://console.groq.com/keys |
| OpenRouter | `OPENROUTER_API_KEY` | ✅ free models (`:free`) | `meta-llama/llama-3.3-70b-instruct:free` | https://openrouter.ai/keys |
| OpenAI     | `OPENAI_API_KEY`     | ❌ paid (prepaid)      | `gpt-4o-mini`                              | https://platform.openai.com |

> **Note:** A ChatGPT (chatgpt.com) subscription does **not** fund the OpenAI API — it's
> billed separately. If you want a free option, use Gemini, Groq, or OpenRouter.

Configuration (in `.env`):

```env
# Priority order — first listed is tried first, then fall back left→right.
TRANSLATION_PROVIDER_ORDER=gemini,groq,openrouter,openai

GEMINI_API_KEY=your-gemini-key        # enable Gemini (recommended free option)
# GROQ_API_KEY=...                     # optional extra fallback
# OPENROUTER_API_KEY=...               # optional extra fallback
# OPENAI_API_KEY=...                   # optional paid fallback
# Each provider also accepts a *_MODEL override and OpenAI accepts OPENAI_BASE_URL.
```

**Multiple keys per provider.** Any `*_API_KEY` may be a comma-separated list to
multiply a free tier's rate limit. Requests rotate across the keys (round-robin),
and on a `429`/error they fall through to the next key, then the next provider:

```env
GROQ_API_KEY=gsk_key1,gsk_key2,gsk_key3
```

Resolution order for a request becomes: provider 1 → its keys (rotating) → provider 2 → its keys → …

The UI shows which provider served each translation (a "via gemini" badge), or
"cached" when it came from Redis/Postgres.

---

## Security

- Upload validation: extension + MIME filter, size limit (`MAX_UPLOAD_MB`), and a
  structural ZIP/EPUB signature check before parsing.
- Request validation: every body is parsed through a Zod schema (`ZodValidationPipe`).
- Auth: bcrypt password hashing, JWT bearer tokens, route guards; books/progress are
  scoped to the owning user.
- Rate limiting: global throttler (120 req/min/IP).
- Secrets via environment variables; `.env` is git-ignored.

---

## Project layout

```
.
├── apps/
│   ├── api/            NestJS backend (+ Prisma schema, Dockerfile)
│   └── web/            Next.js frontend (App Router, Dockerfile)
├── packages/
│   └── shared/         Zod DTOs + shared TypeScript types
├── nginx/nginx.conf    Reverse proxy (+ SSE passthrough)
├── docker-compose.yml
└── .env.example
```

---

## Adding a new format later (e.g. PDF)

1. `apps/api/src/parsers/pdf/pdf.parser.ts` implementing `EbookParser`
   (`extensions = ['pdf']`, `validate`, `parse`).
2. Register it in `ParserRegistry`'s constructor.

No controller, service, schema, or frontend change required for ingestion.
