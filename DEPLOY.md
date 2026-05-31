# Deploying Cognal (CI/CD → single VPS)

CI/CD is GitHub Actions:

- **`.github/workflows/ci.yml`** — on every PR/push: install, generate Prisma client,
  apply migrations to a throwaway Postgres, lint, and build all packages.
- **`.github/workflows/deploy.yml`** — on push to `main` (or manual run): builds the
  `api` + `web` Docker images, pushes them to **GHCR**, then SSHes to your host and
  runs `docker compose -f docker-compose.prod.yml pull && up -d`. Database
  migrations run automatically when the API container starts.

The host runs **`docker-compose.prod.yml`**, which pulls pre-built images (it never
builds).

---

## 1. One-time GitHub setup

**Repository → Settings → Secrets and variables → Actions.**

### Secrets (encrypted)

| Secret        | What it is                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------ |
| `SSH_HOST`    | Your server's IP or hostname                                                               |
| `SSH_USER`    | SSH user on the server (must be able to run `docker`)                                      |
| `SSH_KEY`     | The **private** SSH key (PEM) whose public key is in the server's `~/.ssh/authorized_keys` |
| `DEPLOY_PATH` | Absolute path of the deploy dir on the host, e.g. `/opt/cognal`                            |

> `GITHUB_TOKEN` is provided automatically — it's used to push to GHCR and to log
> the host in to GHCR during the pull. No personal access token needed.

### Variables (plain, not secret)

| Variable              | Example                       | Notes                                                                              |
| --------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | `https://app.example.com/api` | **Baked into the browser bundle at build time.** Must be your public URL + `/api`. |

---

## 2. One-time host setup

On the server (do this once):

```bash
# a) Install Docker Engine + compose plugin (Debian/Ubuntu)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # log out/in so `docker` works without sudo

# b) Create the deploy dir (must equal the DEPLOY_PATH secret)
sudo mkdir -p /opt/cognal/nginx && sudo chown -R "$USER" /opt/cognal
cd /opt/cognal

# c) Put your production secrets here (this file is NEVER overwritten by CI)
#    Copy .env.example from the repo and fill in real values.
nano .env
```

Minimum values to set in `/opt/cognal/.env`:

```env
POSTGRES_USER=reader
POSTGRES_PASSWORD=<strong-random>
POSTGRES_DB=reader
DATABASE_URL=postgresql://reader:<strong-random>@postgres:5432/reader?schema=public

APP_ENCRYPTION_KEY=<openssl rand -hex 32>
AUTH_SECRET=<openssl rand -base64 32>
API_JWT_SECRET=<openssl rand -base64 32>   # MUST be identical for api + web
AUTH_URL=https://app.example.com           # your public URL
CORS_ORIGINS=https://app.example.com
ADMIN_EMAILS=htanh9320@gmail.com

GROQ_API_KEY=<your-groq-key>               # the free shared AI provider
# Optional Google sign-in:
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

# Image source (defaults are fine if your repo is tuanh2000/cognal-books):
# IMAGE_BASE=ghcr.io/tuanh2000/cognal-books
# IMAGE_TAG=latest
# HTTP_PORT=80
```

> The deploy workflow copies `docker-compose.prod.yml` and `nginx/nginx.conf` into
> `DEPLOY_PATH` on every run, so you don't place those by hand — only `.env`.

Open the firewall for the web port (80, or whatever `HTTP_PORT` you set).

---

## 3. Deploy

Push to `main` (or run the **Deploy** workflow manually). The pipeline builds,
pushes, and restarts the stack. First deploy creates the schema automatically.

Verify:

```bash
curl -s http://<host>/api/health      # {"status":"ok"}
```

Roll back to a previous build by setting `IMAGE_TAG=<git-sha>` in `.env` and
re-running, or on the host: `IMAGE_TAG=<sha> docker compose -f docker-compose.prod.yml up -d`.

---

## 4. TLS / HTTPS (recommended next step)

This setup serves plain HTTP on `HTTP_PORT`. For production, terminate TLS by
either:

- putting a TLS reverse proxy in front (Caddy / Traefik / Cloudflare), or
- adding a certbot-managed cert to the nginx service.

Then set `AUTH_URL` and `NEXT_PUBLIC_API_URL` to `https://...` and add the Google
OAuth redirect `https://<domain>/api/auth/callback/google`.

---

## Manual ops cheatsheet (on the host, in `DEPLOY_PATH`)

```bash
docker compose -f docker-compose.prod.yml ps         # status
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml pull && \
  docker compose -f docker-compose.prod.yml up -d     # manual update
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U reader reader > backup_$(date +%F).sql   # DB backup
```

> Back up the `postgres_data` and `uploads_data` volumes regularly — uploaded
> books live on the host disk (`uploads_data`), not in the DB.
