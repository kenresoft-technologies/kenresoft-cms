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

  it('forwards a multipart upload intact: method, boundary, fields, file bytes, accept and user-agent', async () => {
    const fileBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0x10, 0x0d, 0x0a]);
    const form = new FormData();
    form.set('name', 'Ada Student');
    form.set('document', new File([fileBytes], 'cv.pdf', { type: 'application/pdf' }));
    const incoming = new Request(`${site}/cms/api/v1/public/forms/student-support/submissions`, {
      method: 'POST',
      headers: { cookie: 'session=abc', origin: site, accept: 'application/json', 'user-agent': 'TestBrowser/1.0' },
      body: form,
    });
    const contentType = incoming.headers.get('content-type')!;
    assert.match(contentType, /^multipart\/form-data; boundary=/);

    const { proxy, seen } = setup(() => Response.json({ id: 's-1' }, { status: 201 }));
    const res = await proxy(incoming);
    assert.equal(res.status, 201);

    const sent = seen[0]!;
    assert.equal(sent.url, 'https://api.example.com/api/v1/public/forms/student-support/submissions');
    assert.equal(sent.init.method, 'POST');
    const headers = new Headers(sent.init.headers);
    assert.equal(headers.get('content-type'), contentType);
    assert.equal(headers.get('cookie'), 'session=abc');
    assert.equal(headers.get('origin'), site);
    assert.equal(headers.get('accept'), 'application/json');
    assert.equal(headers.get('user-agent'), 'TestBrowser/1.0');
    // The upstream can parse the forwarded body with the forwarded boundary, byte for byte.
    const received = await new Request('https://api.example.com/', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: sent.init.body as BodyInit,
    }).formData();
    assert.equal(received.get('name'), 'Ada Student');
    const file = received.get('document') as File;
    assert.equal(file.name, 'cv.pdf');
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), fileBytes);
  });

  it('answers 503 with a clear log, not a crash, when the CMS URL is not configured', async () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args[0]);
    try {
      const proxy = createCmsProxy({ url: undefined as unknown as string });
      const res = await proxy(new Request(`${site}/cms/api/v1/auth/get-session`));
      assert.equal(res.status, 503);
      assert.match(String(errors[0]), /PUBLIC_KENRESOFT_CMS_URL/);
    } finally {
      console.error = original;
    }
  });

  it('forwards a multipart account message to /api/v1/account/', async () => {
    const form = new FormData();
    form.set('body', 'Here is the file you asked for.');
    form.append('files', new File([new Uint8Array([1, 2, 3])], 'extra.pdf'));
    const { proxy, seen } = setup(() => Response.json({ id: 'm-1' }, { status: 201 }));
    const res = await proxy(
      new Request(`${site}/cms/api/v1/account/forms/submissions/s-1/messages`, {
        method: 'POST',
        headers: { cookie: 'session=abc', origin: site },
        body: form,
      }),
    );
    assert.equal(res.status, 201);
    assert.equal(seen[0]!.url, 'https://api.example.com/api/v1/account/forms/submissions/s-1/messages');
    assert.ok((seen[0]!.init.body as ArrayBuffer).byteLength > 0);
  });

  it('drops a trailing slash before forwarding, for sites with trailingSlash: "always"', async () => {
    const { proxy, seen } = setup(() => Response.json({ ok: true }));
    const res = await proxy(new Request(`${site}/cms/api/v1/public/pages/?x=1`));
    assert.equal(res.status, 200);
    assert.equal(seen[0]!.url, 'https://api.example.com/api/v1/public/pages?x=1');
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

  it('only forwards the public/auth/account surface — never the admin API or unknown paths', async () => {
    const { proxy, seen } = setup(() => Response.json({}));
    for (const path of [
      '/cms/api/v1/admin/users',
      '/cms/api/v1/system/status',
      '/cms/api/v1/auth/../admin/users',
      '/cms/api/v1/account/../admin/forms',
      '/cms/other',
      '/cms/',
    ]) {
      assert.equal((await proxy(new Request(`${site}${path}`))).status, 404, path);
    }
    assert.equal((await proxy(new Request(`${site}/other`))).status, 404);
    assert.equal(seen.length, 0);
    for (const path of [
      '/cms/api/v1/public/pages',
      '/cms/api/plugins/commerce/public/v1/cart',
      '/cms/api/v1/auth/get-session',
      '/cms/api/v1/account/forms/submissions',
    ]) {
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

describe('createCmsProxy turnstile header', () => {
  it('forwards x-turnstile-token so a protected sign-up works through the proxy', async () => {
    const { proxy, seen } = setup(() => Response.json({}));
    await proxy(new Request(`${site}/cms/api/v1/auth/sign-up/email`, { method: 'POST', headers: { 'x-turnstile-token': 'tok', 'content-type': 'application/json' }, body: '{}' }));
    assert.equal(new Headers(seen[0]!.init.headers).get('x-turnstile-token'), 'tok');
  });
});
