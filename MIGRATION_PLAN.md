# Desktop Migration Contract (web → Electron, PostgreSQL → SQLite)

This is the **single source of truth** every refactor agent must follow so the
parallel workstreams stay compatible. Do not deviate from the names/ports/paths
below without updating this file.

## Goal

Convert the monorepo from a Dockerized web app into a **local-only macOS Electron
desktop app**. Windows comes later — keep platform-specific bits isolated.

Confirmed decisions:

1. **Backend = embedded local server.** Electron's main process spawns the
   existing NestJS API on a localhost port. Renderer keeps calling it over HTTP.
2. **No auth.** Single auto-provisioned local user. Remove login/register + JWT.
3. **Renderer = Next.js static export** (`output: 'export'`), loaded by Electron
   from `file://`.
4. **SQLite replaces PostgreSQL.** Redis is removed (cache moves to SQLite).

## Cross-cutting contract (DO NOT CHANGE unilaterally)

### Ports & networking

- API binds **127.0.0.1** only (never 0.0.0.0), port from `process.env.API_PORT`,
  default **4317**. Global prefix stays `/api`.
- CORS: allow `http://localhost:3000` (dev) and `file://` origins. Simplest:
  reflect origin / allow all since it's localhost-only.

### Data directory

- All user data lives under one dir passed from Electron via env **`READER_DATA_DIR`**
  (Electron sets it to `app.getPath('userData')`). API default when unset (dev):
  `./.reader-data` at repo root.
- Inside `READER_DATA_DIR`:
  - `reader.db` → SQLite database file
  - `uploads/` → stored `.epub` files and extracted cover images
- The SQLite connection string is built at runtime:
  `file:${READER_DATA_DIR}/reader.db`. Set `DATABASE_URL` from this before
  Prisma initializes (in `main.ts` bootstrap, before Nest creates PrismaClient).

### The local user

- A constant user id is used everywhere a `userId` is needed:
  `LOCAL_USER_ID = "local-user"`. On API bootstrap, upsert this user row.
- Replace the `@CurrentUser()` decorator / JwtAuthGuard usage so every request
  resolves to `LOCAL_USER_ID`. Keep the controllers' method signatures working;
  the simplest path is to make `CurrentUser` return `{ userId: LOCAL_USER_ID }`
  and remove the auth guards. Do NOT delete the controllers' user-scoping logic —
  it still scopes data to the local user.

### Renderer ↔ API base URL

- Single constant, build-time: `http://127.0.0.1:4317/api`. In `apps/web` read
  from `process.env.NEXT_PUBLIC_API_URL` with that default so dev still works.

### Renderer routing under static export (IMPORTANT)

- `output: 'export'` cannot serve the runtime dynamic route
  `app/read/[bookId]/page.tsx`. **Convert the reader to a query-param route:**
  move it to `app/read/page.tsx` and read the id from `useSearchParams()`
  (`?bookId=...`). Update every link/`router.push` that targeted
  `/read/${id}` to `/read?bookId=${id}`.
- The root `app/page.tsx` should redirect straight to `/library` (no login gate).
- Remove `app/login` and `app/register` and the `use-auth-guard` gating.
- `next.config`: set `output: 'export'`, add `images: { unoptimized: true }`,
  keep `transpilePackages: ['@reader/shared']`. Output dir is `apps/web/out`.

## Directory ownership (avoid edit collisions)

- **Agent A — API backend** owns everything under `apps/api/**`.
  May read `packages/shared` but must NOT edit it.
- **Agent B — Web renderer** owns everything under `apps/web/**` and
  `packages/shared/**`. Keep auth-related types in `packages/shared` even if
  unused (harmless) so Agent A's imports don't break.
- **Agent C — Electron shell** owns the new `apps/desktop/**`, the root
  `package.json`, `pnpm-workspace.yaml`, and adds an `electron-builder` config.
  Must NOT edit `apps/api` or `apps/web` source (only reference their build
  outputs).

The integrator (main session) wires everything together and runs the builds.

## Build / run model

- Dev: run API (`pnpm --filter @reader/api dev`) + web (`next dev`) + electron
  pointing at `http://localhost:3000`.
- Prod (packaged): electron-builder bundles: Electron main, the API `dist/` +
  its `node_modules` (or a bundled server), Prisma engine + schema, and the
  web `out/` static files. Main process spawns the API, waits for it to be
  healthy, then loads `apps/web/out/index.html`.
- Keep `docker-compose.yml` for now but it is no longer the primary path.
