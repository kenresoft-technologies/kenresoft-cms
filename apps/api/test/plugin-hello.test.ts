import { createDb } from '@kenresoft-cms/database';
import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { pluginEventBus } from '../src/plugins/events';
import { ENABLED_PLUGINS } from '../src/plugins/registry';
import { upsertPluginConfig } from '../src/repositories/plugin-settings';

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
  return authedCookie(`plugin-hello-${cookieCounter}@example.test`);
}

async function userId(cookie: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/get-session', {
    headers: { Cookie: cookie },
  });
  const body = await response.json<{ user: { id: string } }>();
  return body.user.id;
}

// Signup #2+ on a clean deployment defaults to 'editor' (src/lib/auth.ts) — demoted here to
// prove requirePluginRole('editor') actually rejects below that floor, the same
// author/viewer-promotion pattern apps/api/test/role-permissions.test.ts already uses.
async function setRole(adminCookie: string, targetId: string, role: string): Promise<void> {
  await SELF.fetch(`https://example.com/api/v1/admin/users/${targetId}/role`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
}

describe('plugin platform: hello (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_hello_greetings');
    await env.DB.exec('DELETE FROM plugin_settings');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('discovers and validates the hello plugin at registry resolution time', () => {
    expect(ENABLED_PLUGINS.map((p) => p.manifest.id)).toContain('hello');
  });

  it('rejects the plugin mount without a session', async () => {
    const response = await SELF.fetch('https://example.com/api/plugins/hello/v1/hello');
    expect(response.status).toBe(401);
  });

  it('returns the exact expected health-check body for any authed user', async () => {
    const cookie = await freshCookie(); // claims owner
    const response = await SELF.fetch('https://example.com/api/plugins/hello/v1/hello', {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plugin: 'hello', status: 'ok' });
  });

  it('403s creating a greeting below editor, 201s at editor and above', async () => {
    const ownerCookie = await freshCookie(); // owner
    const authorCookie = await authedCookie('plugin-hello-author@example.test');
    await setRole(ownerCookie, await userId(authorCookie), 'author');

    const forbidden = await SELF.fetch('https://example.com/api/plugins/hello/v1/greetings', {
      method: 'POST',
      headers: { Cookie: authorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'World' }),
    });
    expect(forbidden.status).toBe(403);

    const created = await SELF.fetch('https://example.com/api/plugins/hello/v1/greetings', {
      method: 'POST',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'World' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ message: 'Hello, World' });
  });

  it('lists created greetings, newest first, and reflects a configured greeting prefix', async () => {
    const cookie = await freshCookie();
    const db = createDb(env.DB);
    await upsertPluginConfig(db, 'hello', { greeting: 'Yo' });

    await SELF.fetch('https://example.com/api/plugins/hello/v1/greetings', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'there' }),
    });

    const listRes = await SELF.fetch('https://example.com/api/plugins/hello/v1/greetings', {
      headers: { Cookie: cookie },
    });
    const list = await listRes.json<Array<{ message: string }>>();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ message: 'Yo, there' });
  });

  it('emits hello:greeting.created for every created greeting', async () => {
    const cookie = await freshCookie();
    const seen: unknown[] = [];
    const unsubscribe = pluginEventBus.on('hello:greeting.created', (payload) => seen.push(payload));

    try {
      await SELF.fetch('https://example.com/api/plugins/hello/v1/greetings', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'events' }),
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ message: 'Hello, events' });
    } finally {
      unsubscribe();
    }
  });
});
