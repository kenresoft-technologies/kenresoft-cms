import { SELF, env } from 'cloudflare:test';
import { signUpVerifiedAndGetCookie } from './helpers/auth';
import { clearTestEmails, getTestEmails } from '../src/lib/email';
import { beforeEach, describe, expect, it } from 'vitest';

async function adminHeaders(email: string): Promise<Record<string, string>> {
  const cookie = await signUpVerifiedAndGetCookie(email, {
    password: 'correct horse battery staple',
    name: 'Test Admin',
    role: 'admin',
  });
  return { Cookie: cookie, 'Content-Type': 'application/json' };
}

// The Email Templates system: seeding, admin CRUD, safe token substitution (with HTML
// escaping), preview, restore-default, send-test, and the role gate — everything except the
// real auth-integration send paths, which are covered end-to-end by email-verification.test.ts/
// password-reset.test.ts (now rendering through this same system).
describe('email templates (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM email_templates');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
    clearTestEmails();
  });

  it('seeds all three known templates on first access, each enabled and not yet customized', async () => {
    const headers = await adminHeaders('templates-list@example.test');
    const res = await SELF.fetch('https://example.com/api/v1/admin/email-templates', { headers });
    expect(res.status).toBe(200);
    const templates = await res.json<{ key: string; enabled: boolean; isCustomized: boolean; availableVariables: string[] }[]>();
    expect(templates.map((t) => t.key).sort()).toEqual(['email_verification', 'email_verification_staff', 'password_reset']);
    for (const t of templates) {
      expect(t.enabled).toBe(true);
      expect(t.isCustomized).toBe(false);
      expect(t.availableVariables).toEqual(expect.arrayContaining(['site.name', 'design.brandColor']));
    }
  });

  it('classifies a legacy (pre-mode-column) row lazily on first read: untouched bodyHtml becomes Standard, customized bodyHtml becomes Developer', async () => {
    const headers = await adminHeaders('templates-legacy@example.test');

    // Seed normally, then simulate two rows exactly as migration 0055 would have left them —
    // mode/heading/bodyText/ctaLabel/fineprint all NULL, only the old bodyHtml column populated.
    await SELF.fetch('https://example.com/api/v1/admin/email-templates', { headers });
    const untouchedRow = await env.DB.prepare('SELECT body_html FROM email_templates WHERE key = ?')
      .bind('email_verification')
      .first<{ body_html: string }>();
    await env.DB.exec(
      `UPDATE email_templates SET mode = NULL, heading = NULL, body_text = NULL, cta_label = NULL, fineprint = NULL WHERE key = 'email_verification'`,
    );
    await env.DB.prepare(
      `UPDATE email_templates SET mode = NULL, heading = NULL, body_text = NULL, cta_label = NULL, fineprint = NULL, body_html = ? WHERE key = 'password_reset'`,
    )
      .bind('<p>A hand-written custom template, {{user.name}}</p>')
      .run();

    const res = await SELF.fetch('https://example.com/api/v1/admin/email-templates', { headers });
    const templates = await res.json<{ key: string; mode: string; isCustomized: boolean; content: { heading: string } }[]>();
    const untouched = templates.find((t) => t.key === 'email_verification')!;
    const customized = templates.find((t) => t.key === 'password_reset')!;

    expect(untouched.mode).toBe('standard');
    expect(untouched.isCustomized).toBe(false);
    expect(untouched.content.heading).toBe('Verify your email address');

    expect(customized.mode).toBe('developer');
    expect(customized.isCustomized).toBe(true);

    // The classification is persisted, not recomputed every call — a second read shows the same
    // mode without needing the row to still look "legacy".
    const row = await env.DB.prepare('SELECT mode FROM email_templates WHERE key = ?').bind('email_verification').first<{ mode: string }>();
    expect(row?.mode).toBe('standard');
    expect(untouchedRow?.body_html).toBeTruthy();
  });

  it('updates a template in Standard mode, marks it customized, and restore-default reverts it (but leaves enabled alone)', async () => {
    const headers = await adminHeaders('templates-update@example.test');

    const updateRes = await SELF.fetch('https://example.com/api/v1/admin/email-templates/password_reset', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        subject: 'Custom subject',
        content: { heading: 'Reset it', bodyText: 'Custom body copy.', ctaLabel: 'Go', fineprint: 'Expires soon.' },
        enabled: false,
      }),
    });
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json<{ subject: string; mode: string; enabled: boolean; isCustomized: boolean }>();
    expect(updated.subject).toBe('Custom subject');
    expect(updated.mode).toBe('standard');
    expect(updated.enabled).toBe(false);
    expect(updated.isCustomized).toBe(true);

    const restoreRes = await SELF.fetch('https://example.com/api/v1/admin/email-templates/password_reset/restore-default', {
      method: 'POST',
      headers,
    });
    expect(restoreRes.status).toBe(200);
    const restored = await restoreRes.json<{ subject: string; mode: string; enabled: boolean; isCustomized: boolean }>();
    expect(restored.subject).toBe('Reset your password');
    expect(restored.mode).toBe('standard');
    expect(restored.isCustomized).toBe(false);
    // Restoring copy is not the same action as re-enabling — an admin who disabled a template
    // on purpose isn't silently overridden by clicking "Restore default".
    expect(restored.enabled).toBe(false);
  });

  it('switches a template into Developer mode, edits raw HTML directly, and marks it customized', async () => {
    const headers = await adminHeaders('templates-developer-mode@example.test');

    const updateRes = await SELF.fetch('https://example.com/api/v1/admin/email-templates/password_reset', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ mode: 'developer', subject: 'Custom subject', bodyHtml: '<p>Custom {{resetUrl}}</p>' }),
    });
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json<{ mode: string; isCustomized: boolean; bodyHtml: string }>();
    expect(updated.mode).toBe('developer');
    expect(updated.isCustomized).toBe(true);
    expect(updated.bodyHtml).toBe('<p>Custom {{resetUrl}}</p>');
  });

  it('Developer-mode preview renders a (possibly unsaved) body against sample data, substituting and HTML-escaping variables, and sanitizes the output', async () => {
    const headers = await adminHeaders('templates-preview@example.test');

    const res = await SELF.fetch('https://example.com/api/v1/admin/email-templates/password_reset/preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mode: 'developer',
        subject: 'Hi {{user.name}}',
        bodyHtml: '<p>Click <a href="{{resetUrl}}">here</a>, {{user.name}}</p><script>alert(1)</script>',
      }),
    });
    expect(res.status).toBe(200);
    const rendered = await res.json<{ subject: string; html: string; text: string }>();
    expect(rendered.subject).toBe('Hi Jane Doe');
    expect(rendered.html).toContain('https://example.com/reset-password?token=sample-preview-token');
    expect(rendered.html).toContain('Jane Doe');
    // The sanitizer strips <script> entirely — proof preview goes through the same
    // sanitizeEmailHtml() pipeline as a real send, not raw unsanitized output.
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).not.toContain('alert(1)');
    expect(rendered.text).toContain('Jane Doe');
  });

  it('Standard-mode preview renders structured content through the active design, escaping admin-supplied text', async () => {
    const headers = await adminHeaders('templates-preview-standard@example.test');

    const res = await SELF.fetch('https://example.com/api/v1/admin/email-templates/password_reset/preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mode: 'standard',
        subject: 'Reset it',
        content: {
          heading: '<script>alert(1)</script>Reset your password',
          bodyText: 'Tap the button below.',
          ctaLabel: 'Reset',
          fineprint: 'Expires soon.',
        },
      }),
    });
    expect(res.status).toBe(200);
    const rendered = await res.json<{ html: string }>();
    expect(rendered.html).toContain('https://example.com/reset-password?token=sample-preview-token');
    expect(rendered.html).toContain('Tap the button below.');
    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    // The structural greeting is always present and never editable through `content`.
    expect(rendered.html).toContain('Jane Doe');
  });

  it("the design gallery's preview accepts a candidate designId without changing what's saved", async () => {
    const headers = await adminHeaders('templates-preview-design@example.test');

    const designsRes = await SELF.fetch('https://example.com/api/v1/admin/email-templates/designs', { headers });
    expect(designsRes.status).toBe(200);
    const designs = await designsRes.json<{ id: string }[]>();
    expect(designs.map((d) => d.id).sort()).toEqual(['cloudflare-inspired', 'corporate', 'elegant', 'modern-minimal', 'simple']);

    const res = await SELF.fetch('https://example.com/api/v1/admin/email-templates/email_verification/preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mode: 'standard',
        subject: 'Verify',
        designId: 'simple',
        content: { heading: 'Verify your email', bodyText: 'One click.', ctaLabel: 'Verify', fineprint: 'Expires soon.' },
      }),
    });
    expect(res.status).toBe(200);

    // The deployment's actually-active design (never saved here) is untouched by a preview call.
    const listRes = await SELF.fetch('https://example.com/api/v1/admin/structured-settings/emailBranding', { headers });
    const branding = await listRes.json();
    expect(branding).toBeNull();
  });

  it('HTML-escapes a variable value that itself contains markup, so it can never break out of the template', async () => {
    const headers = await adminHeaders('templates-escape@example.test');

    // general.siteName flows into every template as {{site.name}} (context.ts) — set it to a
    // value containing real markup to prove substitution escapes it rather than injecting it.
    await SELF.fetch('https://example.com/api/v1/admin/structured-settings/general', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ siteName: '<img src=x onerror=alert(1)>Evil Co', tagline: null, logoMediaId: null }),
    });

    const res = await SELF.fetch('https://example.com/api/v1/admin/email-templates/email_verification/preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({ mode: 'developer', subject: 'Hi {{user.name}}', bodyHtml: '<p>{{site.name}}</p>' }),
    });
    expect(res.status).toBe(200);
    const rendered = await res.json<{ html: string }>();
    // Not a live tag: no unescaped "<img", only the inert, HTML-escaped text form.
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;Evil Co');
  });

  it('rejects an unrecognized template key with the standard validation-error shape', async () => {
    const headers = await adminHeaders('templates-bad-key@example.test');
    const res = await SELF.fetch('https://example.com/api/v1/admin/email-templates/not_a_real_key', { headers });
    expect(res.status).toBe(400);
  });

  it('send-test sends the currently saved template to a recipient, prefixed as a test, and never uses a real token', async () => {
    const headers = await adminHeaders('templates-send-test@example.test');

    await SELF.fetch('https://example.com/api/v1/admin/email-templates/email_verification', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ subject: 'Verify, {{user.name}}!' }),
    });

    const res = await SELF.fetch('https://example.com/api/v1/admin/email-templates/email_verification/send-test', {
      method: 'POST',
      headers,
      body: JSON.stringify({ to: 'test-recipient@example.test' }),
    });
    expect(res.status).toBe(200);

    const emails = getTestEmails().filter((m) => m.to === 'test-recipient@example.test');
    expect(emails).toHaveLength(1);
    expect(emails[0]!.subject).toContain('[Test]');
    expect(emails[0]!.subject).toContain('Verify, Jane Doe!');
    expect(emails[0]!.html).toContain('sample-preview-token');
    expect(emails[0]!.html).toMatch(/no real action was taken/);
  });

  it('every route is admin-only', async () => {
    const editorCookie = await signUpVerifiedAndGetCookie('templates-editor@example.test', {
      password: 'correct horse battery staple',
      name: 'Editor User',
      role: 'editor',
    });
    const headers = { Cookie: editorCookie, 'Content-Type': 'application/json' };

    const list = await SELF.fetch('https://example.com/api/v1/admin/email-templates', { headers });
    expect(list.status).toBe(403);

    const patch = await SELF.fetch('https://example.com/api/v1/admin/email-templates/password_reset', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ subject: 'x' }),
    });
    expect(patch.status).toBe(403);
  });
});
