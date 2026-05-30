-- Allow multiple API keys per (user, provider): drop the uniqueness constraint
-- and replace it with a plain lookup index. Written idempotently so it can be
-- safely re-applied after a partial/interrupted run.

-- DropIndex
DROP INDEX IF EXISTS "user_api_keys_userId_provider_key";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_api_keys_userId_provider_idx" ON "user_api_keys"("userId", "provider");
