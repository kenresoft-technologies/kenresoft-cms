import { createDb } from '@kenresoft-cms/database';
import { PLUGIN_SDK_VERSION } from '@kenresoft-cms/plugin-sdk';
import type { PluginManifest, PluginRegistration } from '@kenresoft-cms/plugin-sdk';
import { SELF, env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import { checkPluginEnablement } from '../src/plugins/enablement';
import { setPluginEnabled } from '../src/repositories/plugin-enablement';

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
  return authedCookie(`plugin-enablement-${cookieCounter}@example.test`);
}

function fakeRegistration(manifest: PluginManifest): PluginRegistration {
  return { manifest, routes: new Hono() };
}

describe('plugin enablement (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_enablement');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  describe('checkPluginEnablement', () => {
    it('is enabled by default when no row exists', async () => {
      const db = createDb(env.DB);
      expect(await checkPluginEnablement(db, 'hello')).toBe(true);
    });

    it('is not enabled once explicitly disabled', async () => {
      const db = createDb(env.DB);
      await setPluginEnabled(db, 'hello', false);
      expect(await checkPluginEnablement(db, 'hello')).toBe(false);
    });

    it('treats a plugin as unusable if a declared dependency is disabled, even though it is itself enabled', async () => {
      const db = createDb(env.DB);
      const dependentManifest: PluginManifest = {
        id: 'dependent',
        name: 'Dependent',
        version: '0.1.0',
        sdkVersion: PLUGIN_SDK_VERSION,
        dependencies: { fake: '*' },
      };
      const plugins = [fakeRegistration(dependentManifest)];

      expect(await checkPluginEnablement(db, 'dependent', plugins)).toBe(true);
      await setPluginEnabled(db, 'fake', false);
      expect(await checkPluginEnablement(db, 'dependent', plugins)).toBe(false);
    });
  });

  describe('the hello plugin mount, live', () => {
    beforeEach(async () => {
      await env.DB.exec('DELETE FROM plugin_hello_greetings');
    });

    it('404s the entire mount once disabled, regardless of session, and restores on re-enable', async () => {
      const cookie = await freshCookie();
      const db = createDb(env.DB);

      const beforeDisableAnon = await SELF.fetch('https://example.com/api/plugins/hello/v1/hello');
      expect(beforeDisableAnon.status).toBe(401); // no session yet, plugin still enabled

      await setPluginEnabled(db, 'hello', false);

      const disabledAnon = await SELF.fetch('https://example.com/api/plugins/hello/v1/hello');
      expect(disabledAnon.status).toBe(404);
      const disabledAuthed = await SELF.fetch('https://example.com/api/plugins/hello/v1/hello', {
        headers: { Cookie: cookie },
      });
      expect(disabledAuthed.status).toBe(404);

      await setPluginEnabled(db, 'hello', true);
      const reenabled = await SELF.fetch('https://example.com/api/plugins/hello/v1/hello', {
        headers: { Cookie: cookie },
      });
      expect(reenabled.status).toBe(200);
    });
  });

  describe('admin plugins routes', () => {
    it('rejects listing without a session, but allows any authenticated role to read it', async () => {
      const anonymous = await SELF.fetch('https://example.com/api/v1/admin/plugins');
      expect(anonymous.status).toBe(401);

      await freshCookie(); // claim owner first
      const editorCookie = await authedCookie('plugin-enablement-editor@example.test');
      const asEditor = await SELF.fetch('https://example.com/api/v1/admin/plugins', {
        headers: { Cookie: editorCookie },
      });
      expect(asEditor.status).toBe(200);
    });

    it('rejects toggling for a non-admin, allows it for an owner', async () => {
      const ownerCookie = await freshCookie(); // claim owner first
      const editorCookie = await authedCookie('plugin-enablement-editor@example.test');

      const forbidden = await SELF.fetch('https://example.com/api/v1/admin/plugins/hello', {
        method: 'PATCH',
        headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(forbidden.status).toBe(403);

      const allowed = await SELF.fetch('https://example.com/api/v1/admin/plugins/hello', {
        method: 'PATCH',
        headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(allowed.status).toBe(200);
    });

    it('lists the hello plugin with its manifest metadata and live enabled state, and toggles it', async () => {
      const cookie = await freshCookie();

      const listRes = await SELF.fetch('https://example.com/api/v1/admin/plugins', { headers: { Cookie: cookie } });
      expect(listRes.status).toBe(200);
      const list = await listRes.json<Array<{ id: string; name: string; version: string; enabled: boolean }>>();
      const hello = list.find((p) => p.id === 'hello');
      expect(hello).toMatchObject({ id: 'hello', name: 'Hello', enabled: true });

      const patchRes = await SELF.fetch('https://example.com/api/v1/admin/plugins/hello', {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(patchRes.status).toBe(200);
      expect(await patchRes.json()).toMatchObject({ id: 'hello', enabled: false });

      const listAfter = await SELF.fetch('https://example.com/api/v1/admin/plugins', { headers: { Cookie: cookie } });
      const afterHello = (await listAfter.json<Array<{ id: string; enabled: boolean }>>()).find(
        (p) => p.id === 'hello',
      );
      expect(afterHello?.enabled).toBe(false);
    });

    it('404s toggling a plugin id that is not bundled', async () => {
      const cookie = await freshCookie();
      const response = await SELF.fetch('https://example.com/api/v1/admin/plugins/does-not-exist', {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(response.status).toBe(404);
    });
  });
});
