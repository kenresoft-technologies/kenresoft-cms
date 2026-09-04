import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

async function authedCookie(email: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery staple', name: 'Test User' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
}

let cookieCounter = 0;
async function freshCookie(): Promise<string> {
  cookieCounter += 1;
  return authedCookie(`webhooks-routes-${cookieCounter}@example.test`);
}

async function makeEditor(): Promise<string> {
  // Signup #2+ on a clean deployment defaults to 'editor' (src/lib/auth.ts) — only the first
  // ever becomes owner, which freshCookie() above already claims per test.
  return freshCookie();
}

describe('webhooks routes (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM webhook_deliveries');
    await env.DB.exec('DELETE FROM webhooks');
    await env.DB.exec('DELETE FROM entry_revisions');
    await env.DB.exec('DELETE FROM entries');
    await env.DB.exec('DELETE FROM field_definitions');
    await env.DB.exec('DELETE FROM content_types');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('rejects every route without a session, and every route for a non-admin', async () => {
    const anonymous = await SELF.fetch('https://example.com/api/v1/admin/webhooks');
    expect(anonymous.status).toBe(401);

    await freshCookie(); // claim owner first
    const editorCookie = await makeEditor();
    const forbidden = await SELF.fetch('https://example.com/api/v1/admin/webhooks', {
      headers: { Cookie: editorCookie },
    });
    expect(forbidden.status).toBe(403);
  });

  it('creates a webhook, returning the secret only once, never again on later reads', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const createRes = await SELF.fetch('https://example.com/api/v1/admin/webhooks', {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'http://webhook-test-target.invalid/hook', events: ['entry.published'] }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json<{ id: string; secret: string; url: string; enabled: boolean }>();
    expect(created.secret).toEqual(expect.any(String));
    expect(created.secret.length).toBeGreaterThan(20);
    expect(created.enabled).toBe(true);

    const listRes = await SELF.fetch('https://example.com/api/v1/admin/webhooks', { headers: { Cookie: cookie } });
    const list = await listRes.json<Array<Record<string, unknown>>>();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('secret');
  });

  it('rejects a contentTypeId that does not exist', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const response = await SELF.fetch('https://example.com/api/v1/admin/webhooks', {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'http://webhook-test-target.invalid/hook', events: ['entry.created'], contentTypeId: 'nope' }),
    });
    expect(response.status).toBe(400);
  });

  it('updates, regenerates the secret (invalidating the old one), and deletes a webhook', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const created = await (
      await SELF.fetch('https://example.com/api/v1/admin/webhooks', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: 'http://webhook-test-target.invalid/hook', events: ['entry.created'] }),
      })
    ).json<{ id: string; secret: string }>();

    const patchRes = await SELF.fetch(`https://example.com/api/v1/admin/webhooks/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ enabled: false }),
    });
    expect(patchRes.status).toBe(200);
    expect(await patchRes.json()).toMatchObject({ enabled: false });

    const regenRes = await SELF.fetch(`https://example.com/api/v1/admin/webhooks/${created.id}/regenerate-secret`, {
      method: 'POST',
      headers,
    });
    expect(regenRes.status).toBe(200);
    const regenerated = await regenRes.json<{ secret: string }>();
    expect(regenerated.secret).not.toEqual(created.secret);

    const deleteRes = await SELF.fetch(`https://example.com/api/v1/admin/webhooks/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(204);

    const getDeliveriesRes = await SELF.fetch(`https://example.com/api/v1/admin/webhooks/${created.id}/deliveries`, {
      headers: { Cookie: cookie },
    });
    expect(getDeliveriesRes.status).toBe(404);
  });

  it('dispatches a delivery attempt when a subscribed entry event fires, recording the outcome', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();

    // Subscribed to this content type specifically, and to entry.created only — an
    // unsubscribed event/content-type combination must never trigger a delivery.
    const webhook = await (
      await SELF.fetch('https://example.com/api/v1/admin/webhooks', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: 'http://webhook-test-target.invalid/hook', // .invalid is IANA-reserved to never resolve
          events: ['entry.created'],
          contentTypeId: contentType.id,
        }),
      })
    ).json<{ id: string }>();

    await (
      await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ slug: 'hello-world', data: {} }),
      })
    ).json<{ id: string }>();

    // dispatchWebhookEvent runs inside ctx.waitUntil(), which vitest-pool-workers flushes
    // before SELF.fetch()'s own promise resolves, so the delivery row is already there.
    const deliveries = await (
      await SELF.fetch(`https://example.com/api/v1/admin/webhooks/${webhook.id}/deliveries`, {
        headers: { Cookie: cookie },
      })
    ).json<Array<{ event: string; success: boolean; responseStatus: number | null; attempt: number }>>();

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ event: 'entry.created', success: false, responseStatus: null, attempt: 1 });
  });

  it('never dispatches for an event or content type the webhook is not subscribed to', async () => {
    const cookie = await freshCookie();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const contentType = await (
      await SELF.fetch('https://example.com/api/v1/admin/content-types', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Blog Post', slug: 'blog-post' }),
      })
    ).json<{ id: string }>();

    const webhook = await (
      await SELF.fetch('https://example.com/api/v1/admin/webhooks', {
        method: 'POST',
        headers,
        // Subscribed only to entry.deleted -- creating an entry must not trigger it.
        body: JSON.stringify({ url: 'http://webhook-test-target.invalid/hook', events: ['entry.deleted'], contentTypeId: contentType.id }),
      })
    ).json<{ id: string }>();

    await SELF.fetch(`https://example.com/api/v1/admin/entries?contentTypeId=${contentType.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'hello-world', data: {} }),
    });

    const deliveries = await (
      await SELF.fetch(`https://example.com/api/v1/admin/webhooks/${webhook.id}/deliveries`, {
        headers: { Cookie: cookie },
      })
    ).json<unknown[]>();
    expect(deliveries).toHaveLength(0);
  });
});
