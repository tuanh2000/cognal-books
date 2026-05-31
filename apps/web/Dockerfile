# Build context must be the repo root (see docker-compose.yml).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter @reader/web... --no-frozen-lockfile

FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY packages/shared packages/shared
COPY apps/web apps/web
# The Prisma schema lives in the API package; copy it into the web package so
# `prisma generate` infers this package (which has the prisma CLI) as its root,
# then generate the client that Auth.js + register/analytics routes import.
COPY apps/api/prisma/schema.prisma apps/web/prisma/schema.prisma
RUN pnpm --filter @reader/web exec prisma generate \
  && pnpm --filter @reader/shared build \
  && pnpm --filter @reader/web build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js "standalone" output bundles a minimal server + traced node_modules
# (incl. @prisma/client + engine, kept external in next.config). Monorepo layout
# nests under apps/web/ because outputFileTracingRoot is the repo root.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
