import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// Symmetric encryption for user-supplied API keys. AES-256-GCM gives us both
// confidentiality and tamper detection (auth tag). The 32-byte key is derived
// from APP_ENCRYPTION_KEY (falling back to JWT_SECRET so local dev works out of
// the box) via scrypt with a fixed salt — deterministic so we can decrypt later.
const SALT = 'reader-api-key-v1';

function key(): Buffer {
  const secret = process.env.APP_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('APP_ENCRYPTION_KEY (or JWT_SECRET) must be set to encrypt API keys');
  }
  return scryptSync(secret, SALT, 32);
}

/** Encrypt to "iv:authTag:ciphertext" (all hex). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

/** Reverse of encryptSecret; throws if the payload was tampered with. */
export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Malformed encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/** A display-safe mask that never reveals the key (last 4 chars only). */
export function maskSecret(plain: string): string {
  return `••••${plain.slice(-4)}`;
}
