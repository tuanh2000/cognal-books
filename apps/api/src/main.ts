import 'reflect-metadata';
import { mkdirSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getUploadDir } from './common/paths';
import { LOCAL_USER_ID, LOCAL_USER_EMAIL } from './common/local-user';
import { AppModule } from './app.module';

/**
 * Ensure the single local user row exists so userId foreign keys resolve.
 *
 * NOTE: this is a transitional shim from the single-user desktop app. Real
 * multi-user auth (Auth.js) replaces it in a later phase, at which point this
 * and common/local-user.ts are removed.
 */
async function ensureLocalUser(): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    await prisma.user.upsert({
      where: { id: LOCAL_USER_ID },
      create: { id: LOCAL_USER_ID, email: LOCAL_USER_EMAIL, passwordHash: '' },
      update: {},
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function bootstrap() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required (PostgreSQL connection string).');
  }

  // Uploads live on a mounted volume in Docker (UPLOAD_DIR); create it if absent.
  const uploadDir = getUploadDir();
  mkdirSync(uploadDir, { recursive: true });
  Logger.log(`Upload dir: ${uploadDir}`, 'Bootstrap');

  // Schema migrations are applied out-of-band via `prisma migrate deploy`
  // (Docker entrypoint) / `prisma migrate dev` (local) — not at runtime.
  await ensureLocalUser();

  const app = await NestFactory.create(AppModule, { cors: false });

  // All routes prefixed with /api.
  app.setGlobalPrefix('api');

  // Restrict CORS to the configured web origin(s); allow all only if unset (dev).
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins.length > 0 ? corsOrigins : true, credentials: true });

  const port = Number(process.env.API_PORT ?? 4000);
  // Bind all interfaces so other containers (nginx) can reach the API.
  const host = process.env.API_HOST ?? '0.0.0.0';
  await app.listen(port, host);
  Logger.log(`API listening on http://${host}:${port}/api`, 'Bootstrap');
}

void bootstrap();
