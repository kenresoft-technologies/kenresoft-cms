// Signed, time-limited tokens that let one specific draft entry be fetched through the
// preview-only public route (routes/public/preview.ts) without loosening the normal public
// API's "drafts are indistinguishable from nonexistent slugs" guarantee (docs/ARCHITECTURE.md
// Phase 6/§13) — a request with no token, or an invalid/expired/mismatched one, 404s exactly
// like the normal route always has.
//
// Signed with a key derived from BETTER_AUTH_SECRET via HMAC, not the raw secret itself and not
// a new required deployment secret — deriving keeps this feature zero-config for every existing
// deployment (no new secret to set before `pnpm run update` picks it up) while still keeping the
// preview-signing key distinct from the session-signing one, so a leaked preview token's key
// can't be trivially turned into the real auth secret or vice versa.

const PREVIEW_KEY_INFO = 'kenresoft-cms:preview-token:v1';
const DEFAULT_TTL_SECONDS = 15 * 60;

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function derivePreviewKey(authSecret: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const derivedBytes = await crypto.subtle.sign('HMAC', baseKey, new TextEncoder().encode(PREVIEW_KEY_INFO));
  return crypto.subtle.importKey('raw', derivedBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

interface PreviewTokenPayload {
  entryId: string;
  exp: number;
}

export async function signPreviewToken(
  authSecret: string,
  entryId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<{ token: string; expiresAt: Date }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload: PreviewTokenPayload = { entryId, exp };
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));

  const key = await derivePreviewKey(authSecret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload));
  const encodedSignature = base64UrlEncode(new Uint8Array(signature));

  return { token: `${encodedPayload}.${encodedSignature}`, expiresAt: new Date(exp * 1000) };
}

// Every failure mode (malformed, bad signature, wrong entry, expired) collapses to the same
// `false` so the caller (routes/public/preview.ts) 404s uniformly regardless of which check
// failed — the same "never distinguishable" property the normal public route already has.
export async function verifyPreviewToken(authSecret: string, token: string, expectedEntryId: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encodedPayload, encodedSignature] = parts;

  try {
    const key = await derivePreviewKey(authSecret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(encodedSignature!),
      new TextEncoder().encode(encodedPayload),
    );
    if (!valid) return false;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload!))) as PreviewTokenPayload;
    if (payload.entryId !== expectedEntryId) return false;
    if (payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}
