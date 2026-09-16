// SSRF hardening for outbound webhook deliveries (apps/api/src/lib/webhooks.ts). Workers'
// `fetch` gives no pre-connect hook to inspect the actually-resolved IP, so this is
// pattern-based, not a full DNS-rebinding-proof sandbox — it blocks the realistic bulk of the
// risk (an admin pointing a webhook at localhost/an RFC1918 address/a cloud metadata endpoint,
// or a redirect chain landing on one) without needing infrastructure this runtime doesn't
// expose. Applied both when a webhook URL is created/updated (routes/admin/webhooks.ts) and
// again immediately before every dispatch attempt (defense in depth against a hostname that
// resolves differently later, and against redirects).

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPrivateOrReservedIPv4(host: string): boolean {
  const match = IPV4_PATTERN.exec(host);
  if (!match) return false;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((n) => n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];

  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local, includes cloud metadata (169.254.169.254)
  if (a === 0) return true; // "this network" / unspecified
  if (a >= 224 && a <= 239) return true; // multicast
  if (a >= 240) return true; // reserved
  return false;
}

function isPrivateOrReservedIPv6(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local fc00::/7
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true; // link-local fe80::/10
  }
  if (normalized.startsWith('ff')) return true; // multicast ff00::/8
  // IPv4-mapped/compatible addresses (::ffff:127.0.0.1, ::127.0.0.1) — check the embedded IPv4.
  const embeddedIPv4 = /(?:^|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(normalized);
  if (embeddedIPv4?.[1] && isPrivateOrReservedIPv4(embeddedIPv4[1])) return true;
  return false;
}

// Hostnames with no DNS lookup needed to know they're dangerous — the loopback name itself, and
// the well-known cloud-metadata hostnames (AWS/GCP/Azure/DigitalOcean all resolve their
// metadata endpoint to 169.254.169.254, already covered above, but some also answer on a named
// host).
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata.internal']);

export function isBlockedWebhookHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) return true;
  if (IPV4_PATTERN.test(host)) return isPrivateOrReservedIPv4(host);
  if (host.includes(':')) return isPrivateOrReservedIPv6(host);
  return false;
}

export interface WebhookUrlCheckResult {
  ok: boolean;
  error?: string;
}

// `allowPrivateDestinations` is the explicit, per-webhook opt-in for deployments that
// deliberately want to notify an internal service (e.g. a self-hosted automation tool on the
// same private network as this Worker's own tunnel/VPC binding) — never a global default.
export function checkWebhookUrl(rawUrl: string, allowPrivateDestinations: boolean): WebhookUrlCheckResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// destinations are allowed' };
  }
  if (!allowPrivateDestinations && isBlockedWebhookHost(parsed.hostname)) {
    return {
      ok: false,
      error:
        'This destination looks like a localhost/private-network/link-local/metadata address, ' +
        'which is blocked by default. Enable "Allow private destinations" on this webhook if this is intentional.',
    };
  }
  return { ok: true };
}
