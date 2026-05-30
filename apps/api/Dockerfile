# Build context must be the repo root (see docker-compose.yml).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --filter @reader/api... --no-frozen-lockfile

# ---- build ----
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @reader/shared build \
  && pnpm --filter @reader/api exec prisma generate \
  && pnpm --filter @reader/api build

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api ./apps/api
WORKDIR /app/apps/api
EXPOSE 4000
# Apply migrations then boot. Call the prisma binary directly — using `pnpm exec`
# at runtime triggers a workspace dependency check / reinstall that fails because
# the full monorepo + lockfile aren't present in this minimal runtime image.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
