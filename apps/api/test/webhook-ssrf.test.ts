import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { checkWebhookUrl, isBlockedWebhookHost } from '../src/lib/ssrf-guard';
import { signUpVerifiedAndGetCookie } from './helpers/auth';

async function authedCookie(email: string): Promise<string> {
  return signUpVerifiedAndGetCookie(email, { password: 'correct horse battery staple', name: 'Test User' });
}

describe('isBlockedWebhookHost (pure unit tests)', () => {
  it('blocks loopback addresses and hostnames', () => {
    expect(isBlockedWebhookHost('127.0.0.1')).toBe(true);
    expect(isBlockedWebhookHost('127.255.255.255')).toBe(true);
    expect(isBlockedWebhookHost('localhost')).toBe(true);
    expect(isBlockedWebhookHost('foo.localhost')).toBe(true);
    expect(isBlockedWebhookHost('::1')).toBe(true);
  });

  it('blocks RFC1918 private ranges', () => {
    expect(isBlockedWebhookHost('10.0.0.1')).toBe(true);
    expect(isBlockedWebhookHost('10.255.255.255')).toBe(true);
    expect(isBlockedWebhookHost('172.16.0.1')).toBe(true);
    expect(isBlockedWebhookHost('172.31.255.255')).toBe(true);
    expect(isBlockedWebhookHost('172.15.0.1')).toBe(false); // just outside the 172.16-31 range
    expect(isBlockedWebhookHost('192.168.1.1')).toBe(true);
  });

  it('blocks link-local addresses, including the cloud metadata endpoint', () => {
    expect(isBlockedWebhookHost('169.254.169.254')).toBe(true); // AWS/GCP/Azure/DO metadata
    expect(isBlockedWebhookHost('169.254.0.1')).toBe(true);
    expect(isBlockedWebhookHost('metadata.google.internal')).toBe(true);
    expect(isBlockedWebhookHost('fe80::1')).toBe(true);
  });

  it('blocks unspecified, multicast, and reserved ranges', () => {
    expect(isBlockedWebhookHost('0.0.0.0')).toBe(true);
    expect(isBlockedWebhookHost('224.0.0.1')).toBe(true); // multicast
    expect(isBlockedWebhookHost('240.0.0.1')).toBe(true); // reserved
    expect(isBlockedWebhookHost('::')).toBe(true);
    expect(isBlockedWebhookHost('ff02::1')).toBe(true); // IPv6 multicast
  });

  it('blocks IPv4-mapped IPv6 loopback/private addresses', () => {
    expect(isBlockedWebhookHost('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedWebhookHost('::ffff:10.0.0.1')).toBe(true);
  });

  it('allows ordinary public hostnames and IPs', () => {
    expect(isBlockedWebhookHost('example.com')).toBe(false);
    expect(isBlockedWebhookHost('api.example.com')).toBe(false);
    expect(isBlockedWebhookHost('8.8.8.8')).toBe(false);
    expect(isBlockedWebhookHost('2001:4860:4860::8888')).toBe(false); // public IPv6 (Google DNS)
  });
});

describe('checkWebhookUrl (pure unit tests)', () => {
  it('rejects a private destination by default', () => {
    expect(checkWebhookUrl('http://127.0.0.1/hook', false).ok).toBe(false);
    expect(checkWebhookUrl('http://169.254.169.254/latest/meta-data', false).ok).toBe(false);
    expect(checkWebhookUrl('http://localhost:3000/hook', false).ok).toBe(false);
  });

  it('allows a private destination when allowPrivateDestinations is true', () => {
    expect(checkWebhookUrl('http://127.0.0.1/hook', true).ok).toBe(true);
    expect(checkWebhookUrl('http://192.168.1.5/hook', true).ok).toBe(true);
  });

  it('allows a public destination regardless of the flag', () => {
    expect(checkWebhookUrl('https://example.com/hook', false).ok).toBe(true);
    expect(checkWebhookUrl('https://example.com/hook', true).ok).toBe(true);
  });

  it('rejects a non-http(s) scheme even for an otherwise-public host', () => {
    expect(checkWebhookUrl('ftp://example.com/hook', false).ok).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(checkWebhookUrl('not a url', false).ok).toBe(false);
  });
});

describe('webhook creation/update reject private destinations by default (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM webhooks');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('POST /admin/webhooks rejects a localhost/private-network URL by default', async () => {
    const cookie = await authedCookie('webhook-ssrf-create@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const response = await SELF.fetch('https://example.com/api/v1/admin/webhooks', {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data', events: ['entry.created'] }),
    });
    expect(response.status).toBe(400);
  });

  it('POST /admin/webhooks accepts a private-network URL when allowPrivateDestinations is set', async () => {
    const cookie = await authedCookie('webhook-ssrf-create-allowed@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const response = await SELF.fetch('https://example.com/api/v1/admin/webhooks', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: 'http://192.168.1.5/hook',
        events: ['entry.created'],
        allowPrivateDestinations: true,
      }),
    });
    expect(response.status).toBe(201);
    const created = await response.json<{ allowPrivateDestinations: boolean }>();
    expect(created.allowPrivateDestinations).toBe(true);
  });

  it('PATCH /admin/webhooks/:id rejects switching a webhook to a private URL without also setting the flag', async () => {
    const cookie = await authedCookie('webhook-ssrf-update@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const created = await (
      await SELF.fetch('https://example.com/api/v1/admin/webhooks', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: 'https://example.com/hook', events: ['entry.created'] }),
      })
    ).json<{ id: string }>();

    const response = await SELF.fetch(`https://example.com/api/v1/admin/webhooks/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ url: 'http://127.0.0.1/hook' }),
    });
    expect(response.status).toBe(400);
  });

  it('a delivery to a webhook whose stored allowPrivateDestinations is false skips dispatch to a private host even if the URL changed meaning since creation', async () => {
    // Defense-in-depth: attemptDelivery() re-checks checkWebhookUrl() immediately before every
    // fetch, not just at creation time — simulated here by writing a private URL directly into
    // D1 (bypassing the create/update route's own check) and confirming a triggered dispatch
    // records a failed, never-attempted delivery rather than actually calling fetch().
    const cookie = await authedCookie('webhook-ssrf-dispatch@example.test');
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'SSRF Post', slug: 'ssrf-post' }),
      })
    ).json<{ id: string }>();

    const webhook = await (
      await SELF.fetch('https://example.com/api/v1/admin/webhooks', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: 'https://example.com/hook', events: ['entry.created'], contentTypeId: contentType.id }),
      })
    ).json<{ id: string }>();

    // Simulate meaning-change since creation (e.g. DNS rebinding, or a stale allow-listed value)
    // by writing a private destination directly.
    await env.DB.prepare('UPDATE webhooks SET url = ? WHERE id = ?').bind('http://127.0.0.1:9/hook', webhook.id).run();

    await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'hello', data: {} }),
    });

    const deliveries = await (
      await SELF.fetch(`https://example.com/api/v1/admin/webhooks/${webhook.id}/deliveries`, { headers: { Cookie: cookie } })
    ).json<Array<{ success: boolean; responseStatus: number | null }>>();

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ success: false, responseStatus: null });
  });
});
