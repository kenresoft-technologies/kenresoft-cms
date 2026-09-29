import { eq, integrationSecrets } from '@kenresoft-cms/database';
import type { Database } from '@kenresoft-cms/database';

import type { Bindings } from './env';

// Encrypted-at-rest storage for the few low-risk third-party keys an admin can enter from the CMS
// (see packages/database/schema/integration-secrets.ts for what does and doesn't belong here).
// AES-GCM with a key derived from BETTER_AUTH_SECRET via HMAC, the same derive-don't-reuse approach
// as lib/preview-token.ts — zero new deployment secrets, and the stored value is useless without
// the deployment's own secret. Rotating BETTER_AUTH_SECRET makes stored keys undecryptable; they
// read as "not configured" and just need re-entering.

const KEY_INFO = 'kenresoft-cms:integration-secret:v1';

export type IntegrationKey = 'pixabay';

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function deriveKey(authSecret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = await crypto.subtle.sign('HMAC', base, new TextEncoder().encode(KEY_INFO));
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(authSecret: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(authSecret), new TextEncoder().encode(plaintext)),
  );
  return `${toBase64(iv)}.${toBase64(cipher)}`;
}

// null on any failure (wrong secret, tampered/malformed value) — never throws into a request.
export async function decryptSecret(authSecret: string, stored: string): Promise<string | null> {
  try {
    const [iv, cipher] = stored.split('.');
    if (!iv || !cipher) return null;
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv) },
      await deriveKey(authSecret),
      fromBase64(cipher),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function setIntegrationSecret(
  db: Database,
  env: Bindings,
  key: IntegrationKey,
  value: string,
): Promise<void> {
  const ciphertext = await encryptSecret(env.BETTER_AUTH_SECRET, value);
  await db
    .insert(integrationSecrets)
    .values({ key, ciphertext })
    .onConflictDoUpdate({ target: integrationSecrets.key, set: { ciphertext, updatedAt: new Date() } });
}

export async function deleteIntegrationSecret(db: Database, key: IntegrationKey): Promise<void> {
  await db.delete(integrationSecrets).where(eq(integrationSecrets.key, key));
}

async function getStoredSecret(db: Database, env: Bindings, key: IntegrationKey): Promise<string | null> {
  const row = await db.query.integrationSecrets.findFirst({ where: eq(integrationSecrets.key, key) });
  return row ? decryptSecret(env.BETTER_AUTH_SECRET, row.ciphertext) : null;
}

// A Worker secret always wins over one entered in the admin, so a deployment that already set
// PIXABAY_API_KEY via wrangler keeps working (and can't be silently overridden from the UI).
export async function resolvePixabayKey(
  db: Database,
  env: Bindings,
): Promise<{ key: string | null; source: 'env' | 'admin' | null }> {
  if (env.PIXABAY_API_KEY) return { key: env.PIXABAY_API_KEY, source: 'env' };
  const stored = await getStoredSecret(db, env, 'pixabay');
  return stored ? { key: stored, source: 'admin' } : { key: null, source: null };
}
