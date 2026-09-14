import { createDb } from '@kenresoft-cms/database';
import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { beforeEach, describe, expect, it } from 'vitest';

// Phase 4 of the schema-driven frontend work (docs/SITE_BUILDER.md §3.4/§4.1/§8): admin
// Reusable Blocks CRUD, `type` restricted to leaf/non-referencing block types, and a
// conservative full-Pages-cache purge queued on every update/delete (a reusable block is a
// live reference — §3.4 — so this route can't cheaply know which pages embed it).
async function authedHeaders(email: string): Promise<Record<string, string>> {
  const cookie = await signUpVerifiedAndGetCookie(email, {
    password: 'correct horse battery staple',
    name: 'Test User',
  });
  return { Cookie: cookie, 'Content-Type': 'application/json' };
}

function createReusableBlock(headers: Record<string, string>, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://example.com/api/v1/admin/reusable-blocks', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('admin reusable blocks (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM cache_purge_jobs');
    await env.DB.exec('DELETE FROM reusable_blocks');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('creates, fetches, lists, updates, and deletes a reusable block', async () => {
    const headers = await authedHeaders('reusable-blocks-crud@example.test');

    const created = await (
      await createReusableBlock(headers, { name: 'Global CTA', type: 'cta', config: { buttonLabel: 'Sign up' } })
    ).json<{ id: string; name: string; type: string }>();
    expect(created.name).toBe('Global CTA');
    expect(created.type).toBe('cta');

    const fetched = await (
      await SELF.fetch(`https://example.com/api/v1/admin/reusable-blocks/${created.id}`, {
        headers: { Cookie: headers.Cookie! },
      })
    ).json<{ config: Record<string, unknown> }>();
    expect(fetched.config['buttonLabel']).toBe('Sign up');

    const list = await (
      await SELF.fetch('https://example.com/api/v1/admin/reusable-blocks', { headers: { Cookie: headers.Cookie! } })
    ).json<{ id: string }[]>();
    expect(list.some((block) => block.id === created.id)).toBe(true);

    // A name-only PATCH must never touch `config` — a real, previously-undiscovered bug
    // (docs/SITE_BUILDER.md §24's follow-up pass) had `updateReusableBlockSchema` silently
    // default an omitted `config` to `{}`, wiping it on every partial update that didn't
    // explicitly resend it.
    const updated = await (
      await SELF.fetch(`https://example.com/api/v1/admin/reusable-blocks/${created.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name: 'Global CTA (updated)' }),
      })
    ).json<{ name: string; config: Record<string, unknown> }>();
    expect(updated.name).toBe('Global CTA (updated)');
    expect(updated.config['buttonLabel']).toBe('Sign up');

    const deleteRes = await SELF.fetch(`https://example.com/api/v1/admin/reusable-blocks/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: headers.Cookie! },
    });
    expect(deleteRes.status).toBe(204);

    const afterDelete = await SELF.fetch(`https://example.com/api/v1/admin/reusable-blocks/${created.id}`, {
      headers: { Cookie: headers.Cookie! },
    });
    expect(afterDelete.status).toBe(404);
  });

  it('rejects "columns" and "reusableBlockRef" as a reusable block\'s own type, and queues a full Pages cache purge on update/delete', async () => {
    const headers = await authedHeaders('reusable-blocks-restrictions@example.test');

    const asColumns = await createReusableBlock(headers, { name: 'Bad', type: 'columns', config: {} });
    expect(asColumns.status).toBe(400);

    const asRef = await createReusableBlock(headers, { name: 'Bad', type: 'reusableBlockRef', config: {} });
    expect(asRef.status).toBe(400);

    const created = await (
      await createReusableBlock(headers, { name: 'Footer note', type: 'richText', config: { html: '<p>Hi</p>' } })
    ).json<{ id: string }>();

    const db = createDb(env.DB);
    const beforeUpdate = await db.query.cachePurgeJobs.findMany();
    expect(beforeUpdate).toHaveLength(0);

    await SELF.fetch(`https://example.com/api/v1/admin/reusable-blocks/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Footer note (updated)' }),
    });
    const afterUpdate = await db.query.cachePurgeJobs.findMany();
    expect(afterUpdate.length).toBeGreaterThan(0);
    expect(afterUpdate[0]!.paths).toContain('/api/v1/public/pages');
  });

  // A production-hardening fix (docs/SITE_BUILDER.md §24's follow-up pass): config used to be
  // accepted as any untyped record, unlike Pages/Templates which validate every block's config
  // against its own type's schema via validateBlockTree(). These assert the same enforcement
  // now applies here too.
  it("rejects a config that doesn't match its own block type's schema, on both create and update", async () => {
    const headers = await authedHeaders('reusable-blocks-config-validation@example.test');

    const badCreate = await createReusableBlock(headers, {
      name: 'Bad spacer',
      type: 'spacer',
      config: { height: 'not a number' },
    });
    expect(badCreate.status).toBe(400);

    const badUnknownKey = await createReusableBlock(headers, {
      name: 'Bad hero',
      type: 'hero',
      config: { notARealField: 'x' },
    });
    expect(badUnknownKey.status).toBe(400);

    const created = await (
      await createReusableBlock(headers, { name: 'Valid spacer', type: 'spacer', config: { height: 40 } })
    ).json<{ id: string }>();

    const badUpdate = await SELF.fetch(`https://example.com/api/v1/admin/reusable-blocks/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ config: { height: 'not a number' } }),
    });
    expect(badUpdate.status).toBe(400);

    // Changing `type` without a new `config` is validated against the *merged* result — the
    // still-stored spacer config ({height: 40}) doesn't match hero's own strict schema, so this
    // correctly 400s rather than silently leaving a mismatched type+config pair stored.
    const typeChangeWithStaleConfig = await SELF.fetch(`https://example.com/api/v1/admin/reusable-blocks/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ type: 'hero' }),
    });
    expect(typeChangeWithStaleConfig.status).toBe(400);

    const validTypeChange = await SELF.fetch(`https://example.com/api/v1/admin/reusable-blocks/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ type: 'hero', config: { heading: 'Now a hero' } }),
    });
    expect(validTypeChange.status).toBe(200);
  });
});
