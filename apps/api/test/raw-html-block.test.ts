import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { signUpVerifiedAndGetCookie } from './helpers/auth';

const BASE = 'http://localhost';
const PASSWORD = 'correct horse battery staple';

const HOSTILE =
  '<div class="hero" style="padding: 8px; position: fixed"><h1>Title</h1>' +
  '<script>alert(1)</script><a href="javascript:alert(2)" onclick="x()">link</a></div>';

function json(cookie: string, method: string, body: unknown) {
  return { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function page(route: string, html: string, status: 'draft' | 'published' = 'published') {
  return { route, title: 'Raw', status, blocks: [{ id: 'b1', type: 'rawHtml', config: { html } }] };
}

describe('Raw HTML block safety', () => {
  it('is off by default, admin-only, sanitized on write, and audited', async () => {
    const owner = await signUpVerifiedAndGetCookie('raw-owner@example.test', { password: PASSWORD, name: 'Owner' });
    const editor = await signUpVerifiedAndGetCookie('raw-editor@example.test', { password: PASSWORD, name: 'Editor' });

    // 1. Feature flag off by default: even the owner is refused.
    const off = await SELF.fetch(`${BASE}/api/v1/admin/pages`, json(owner, 'POST', page('/off', HOSTILE)));
    expect(off.status).toBe(400);
    expect((await off.json<{ error: string }>()).error).toMatch(/turned off/i);

    // 2. Admin turns the feature on.
    const enable = await SELF.fetch(
      `${BASE}/api/v1/admin/settings`,
      json(owner, 'PUT', { name: 'Site', featureFlags: { rawHtmlBlocks: true } }),
    );
    expect(enable.status).toBe(200);

    // 3. An editor cannot add a raw block, even with the feature on.
    const denied = await SELF.fetch(`${BASE}/api/v1/admin/pages`, json(editor, 'POST', page('/nope', HOSTILE)));
    expect(denied.status).toBe(403);

    // 4. The owner can, and what is stored is already sanitized.
    const created = await SELF.fetch(`${BASE}/api/v1/admin/pages`, json(owner, 'POST', page('/raw', HOSTILE)));
    expect(created.status).toBe(201);
    const stored = await created.json<{ id: string; blocks: { config: { html: string } }[] }>();
    const html = stored.blocks[0]!.config.html;
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('padding: 8px');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('position');

    // 5. The public API serves the sanitized block.
    const publicRes = await SELF.fetch(`${BASE}/api/v1/public/pages/by-route?route=/raw`);
    expect(publicRes.status).toBe(200);
    const publicPage = await publicRes.json<{ blocks: { type: string; config: { html: string } }[] }>();
    expect(publicPage.blocks[0]!.type).toBe('rawHtml');
    expect(publicPage.blocks[0]!.config.html).not.toContain('<script');

    // 6. An editor can still edit the rest of the page while the raw block is unchanged...
    const untouched = await SELF.fetch(
      `${BASE}/api/v1/admin/pages/${stored.id}`,
      json(editor, 'PATCH', { title: 'Renamed', blocks: stored.blocks }),
    );
    expect(untouched.status).toBe(200);

    // ...but cannot change the raw block itself.
    const changedBlocks = [{ id: 'b1', type: 'rawHtml', config: { html: '<p>changed</p>' } }];
    const changed = await SELF.fetch(
      `${BASE}/api/v1/admin/pages/${stored.id}`,
      json(editor, 'PATCH', { blocks: changedBlocks }),
    );
    expect(changed.status).toBe(403);

    // 7. Sanitize-preview endpoint: admin only.
    const previewOwner = await SELF.fetch(
      `${BASE}/api/v1/admin/pages/sanitize-html`,
      json(owner, 'POST', { html: '<p onclick="x()">hi</p><script>1</script>' }),
    );
    expect(previewOwner.status).toBe(200);
    expect((await previewOwner.json<{ html: string }>()).html).toBe('<p>hi</p>');
    const previewEditor = await SELF.fetch(
      `${BASE}/api/v1/admin/pages/sanitize-html`,
      json(editor, 'POST', { html: '<p>x</p>' }),
    );
    expect(previewEditor.status).toBe(403);

    // 8. Adding raw HTML and the flag switch are both audit-logged.
    const auditRes = await SELF.fetch(`${BASE}/api/v1/admin/audit-log`, { headers: { cookie: owner } });
    const audit = JSON.stringify(await auditRes.json());
    expect(audit).toContain('page.raw_html_changed');
    expect(audit).toContain('settings.raw_html_enabled');
  });

  it('turning the feature off immediately hides raw blocks from the public API', async () => {
    const owner = await signUpVerifiedAndGetCookie('raw-kill@example.test', { password: PASSWORD, name: 'Owner' });
    await SELF.fetch(
      `${BASE}/api/v1/admin/settings`,
      json(owner, 'PUT', { name: 'Site', featureFlags: { rawHtmlBlocks: true } }),
    );
    const created = await SELF.fetch(`${BASE}/api/v1/admin/pages`, json(owner, 'POST', page('/kill', '<p>visible</p>')));
    expect(created.status).toBe(201);

    // Kill switch, before this page has ever been fetched (so no edge-cache entry exists yet).
    const disable = await SELF.fetch(
      `${BASE}/api/v1/admin/settings`,
      json(owner, 'PUT', { name: 'Site', featureFlags: { rawHtmlBlocks: false } }),
    );
    expect(disable.status).toBe(200);

    const res = await SELF.fetch(`${BASE}/api/v1/public/pages/by-route?route=/kill`);
    expect(res.status).toBe(200);
    const body = await res.json<{ blocks: unknown[] }>();
    expect(body.blocks).toEqual([]);
  });
});

describe('Raw HTML block abuse resistance', () => {
  it('refuses a non-admin before doing any sanitising work, even for a huge block', async () => {
    const owner = await signUpVerifiedAndGetCookie('raw-abuse-owner@example.test', { password: PASSWORD, name: 'Owner' });
    const editor = await signUpVerifiedAndGetCookie('raw-abuse-editor@example.test', { password: PASSWORD, name: 'Editor' });
    await SELF.fetch(
      `${BASE}/api/v1/admin/settings`,
      json(owner, 'PUT', { name: 'Site', featureFlags: { rawHtmlBlocks: true } }),
    );

    // 100KB of adversarial input from an editor: refused outright (403), not processed.
    const huge = '<a "'.repeat(25000);
    const res = await SELF.fetch(`${BASE}/api/v1/admin/pages`, json(editor, 'POST', page('/huge', huge)));
    expect(res.status).toBe(403);
  });

});

describe('Rich text block sanitising', () => {
  it('cleans editor-written HTML on write and on the public read, for every role', async () => {
    await signUpVerifiedAndGetCookie('rt-owner@example.test', { password: PASSWORD, name: 'Owner' });
    const editor = await signUpVerifiedAndGetCookie('rt-editor@example.test', { password: PASSWORD, name: 'Editor' });
    const evil = '<h2>Hi</h2><img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">x</a>';

    const created = await SELF.fetch(
      `${BASE}/api/v1/admin/pages`,
      json(editor, 'POST', {
        route: '/rt',
        title: 'RT',
        status: 'published',
        blocks: [{ id: 'r1', type: 'richText', config: { html: evil } }],
      }),
    );
    expect(created.status).toBe(201);
    const stored = (await created.json<{ blocks: { config: { html: string } }[] }>()).blocks[0]!.config.html;
    expect(stored).toContain('<h2>Hi</h2>');
    for (const bad of ['<script', 'onerror', 'javascript:', 'alert']) expect(stored).not.toContain(bad);

    const pub = await SELF.fetch(`${BASE}/api/v1/public/pages/by-route?route=/rt`);
    const html = (await pub.json<{ blocks: { config: { html: string } }[] }>()).blocks[0]!.config.html;
    expect(html).toContain('<h2>Hi</h2>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });
});
