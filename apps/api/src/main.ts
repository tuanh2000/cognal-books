import 'reflect-metadata';
import { mkdirSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getUploadDir } from './common/paths';
import { AppModule } from './app.module';

async function bootstrap() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required (PostgreSQL connection string).');
  }
  if (!process.env.API_JWT_SECRET) {
    throw new Error(
      'API_JWT_SECRET is required (shared with the web app to verify access tokens).',
    );
  }

  // Uploads live on a mounted volume in Docker (UPLOAD_DIR); create it if absent.
  const uploadDir = getUploadDir();
  mkdirSync(uploadDir, { recursive: true });
  Logger.log(`Upload dir: ${uploadDir}`, 'Bootstrap');

  // Schema migrations are applied out-of-band via `prisma migrate deploy`
  // (Docker entrypoint) / `prisma migrate dev` (local) — not at runtime.

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
