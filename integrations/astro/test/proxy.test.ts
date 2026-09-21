// Unit tests for createCmsProxy: allow-list, header forwarding, Set-Cookie passthrough, and the
// trusted client-IP headers. A fake upstream fetch — no network.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCmsProxy } from '../src/index.ts';

function setup(upstream: (url: string, init: RequestInit) => Response, extra: { trustedProxySecret?: string } = {}) {
  const seen: { url: string; init: RequestInit }[] = [];
  const proxy = createCmsProxy({
    url: 'https://api.example.com/',
    ...extra,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), init: init ?? {} });
      return upstream(String(input), init ?? {});
    }) as typeof fetch,
  });
  return { proxy, seen };
}

const site = 'https://www.example.com';

describe('createCmsProxy', () => {
  it('forwards auth calls to the API, preserving method, body, cookie and origin', async () => {
    const { proxy, seen } = setup(() => Response.json({ ok: true }));
    const res = await proxy(
      new Request(`${site}/cms/api/v1/auth/sign-in/email?x=1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'a=b', origin: site, 'x-evil': '1' },
        body: JSON.stringify({ email: 'a@b.co' }),
      }),
    );
    assert.equal(res.status, 200);
    assert.equal(seen[0]!.url, 'https://api.example.com/api/v1/auth/sign-in/email?x=1');
    const sent = new Headers(seen[0]!.init.headers);
    assert.equal(sent.get('cookie'), 'a=b');
    assert.equal(sent.get('origin'), site);
    assert.equal(sent.get('x-evil'), null);
    assert.equal(seen[0]!.init.redirect, 'manual');
  });

  it('passes every Set-Cookie and a redirect Location back untouched', async () => {
    const { proxy } = setup(() => {
      const headers = new Headers({ location: 'https://www.example.com/account/verify-email' });
      headers.append('set-cookie', 'session=abc; Path=/; Secure; SameSite=None');
      headers.append('set-cookie', 'other=1; Path=/');
      return new Response(null, { status: 302, headers });
    });
    const res = await proxy(new Request(`${site}/cms/api/v1/auth/verify-email?token=t`));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://www.example.com/account/verify-email');
    assert.deepEqual(res.headers.getSetCookie(), ['session=abc; Path=/; Secure; SameSite=None', 'other=1; Path=/']);
  });

  it('only forwards the public/auth surface — never the admin API or unknown paths', async () => {
    const { proxy, seen } = setup(() => Response.json({}));
    for (const path of ['/cms/api/v1/admin/users', '/cms/api/v1/system/status', '/cms/api/v1/auth/../admin/users', '/cms/other', '/cms/']) {
      assert.equal((await proxy(new Request(`${site}${path}`))).status, 404, path);
    }
    assert.equal((await proxy(new Request(`${site}/other`))).status, 404);
    assert.equal(seen.length, 0);
    for (const path of ['/cms/api/v1/public/pages', '/cms/api/plugins/commerce/public/v1/cart', '/cms/api/v1/auth/get-session']) {
      assert.equal((await proxy(new Request(`${site}${path}`))).status, 200, path);
    }
  });

  it('adds the trusted client-IP headers only when a secret is configured, and never trusts inbound ones', async () => {
    const withSecret = setup(() => Response.json({}), { trustedProxySecret: 's3cret' });
    await withSecret.proxy(
      new Request(`${site}/cms/api/v1/public/pages`, {
        headers: { 'cf-connecting-ip': '203.0.113.9', 'x-kenresoft-client-ip': '1.1.1.1', 'x-kenresoft-proxy-secret': 'guess' },
      }),
    );
    const sent = new Headers(withSecret.seen[0]!.init.headers);
    assert.equal(sent.get('x-kenresoft-client-ip'), '203.0.113.9');
    assert.equal(sent.get('x-kenresoft-proxy-secret'), 's3cret');

    const without = setup(() => Response.json({}));
    await without.proxy(new Request(`${site}/cms/api/v1/public/pages`, { headers: { 'cf-connecting-ip': '203.0.113.9', 'x-kenresoft-client-ip': '1.1.1.1' } }));
    const sent2 = new Headers(without.seen[0]!.init.headers);
    assert.equal(sent2.get('x-kenresoft-client-ip'), null);
    assert.equal(sent2.get('x-kenresoft-proxy-secret'), null);
  });
});
