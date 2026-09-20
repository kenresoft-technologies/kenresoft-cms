import { createRoute, z } from '@hono/zod-openapi';
import { roleAtLeast, sendAdminEmailSchema } from '@kenresoft-cms/contracts';
import type { UserRole } from '@kenresoft-cms/contracts';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { getAdminFrom, getDefaultReplyTo } from '../../lib/email/admin-sender';
import { collectAttachments, getAttachmentLimits } from '../../lib/email/attachments';
import { buildBodies, buildDesignBodies, parseComposeRequest } from '../../lib/email/compose';
import { getEmailSender, isEmailProviderConfigured } from '../../lib/email';
import { createOpenApiApp } from '../../lib/openapi';
import { sanitizeEmailHtml } from '../../lib/raw-html-sanitizer';
import { adminEmailRateLimit } from '../../middleware/admin-email-rate-limit';
import { requireRole } from '../../middleware/require-role';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

export const emailRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const errorSchema = z.object({ error: z.string() });

emailRoute.openapi(
  createRoute({
    method: 'get',
    path: '/limits',
    tags: ['Email'],
    summary: 'Whether email sending is available, and its attachment limits',
    responses: {
      200: {
        description: 'Provider status and attachment limits.',
        content: {
          'application/json': {
            schema: z.object({
              configured: z.boolean(),
              maxTotalBytes: z.number(),
              maxFiles: z.number(),
            }),
          },
        },
      },
    },
  }),
  (c) => c.json({ configured: isEmailProviderConfigured(c.env), ...getAttachmentLimits(c.env) }, 200),
);

// Multipart (or JSON) — a plain route with a docs-only registerPath, like media upload.
// Sends from Settings' configured sender identity (falling back to EMAIL_FROM), with Reply-To
// defaulting to that sender address (else the staff member's own), overridable per message. No mailbox access of any kind is needed.
emailRoute.post('/send', requireRole('admin', 'editor'), adminEmailRateLimit, async (c) => {
  if (!isEmailProviderConfigured(c.env)) {
    return c.json({ error: 'This deployment has no email provider configured.' }, 400);
  }
  const parsed = await parseComposeRequest(c, sendAdminEmailSchema);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }
  const { fields, files, mediaIds } = parsed.value;
  const db = getDb(c);
  const user = c.get('user');

  // 'Design HTML' keeps the pasted template's layout, so it is admin/owner only — the same floor as
  // the Raw HTML page block. Everyone else keeps the plain rich-text path.
  const design = fields.designHtml === true || fields.designHtml === 'true';
  if (design && !roleAtLeast(user.role as UserRole, 'admin')) {
    return c.json({ error: 'Only an admin or owner can send designed HTML emails.' }, 403);
  }

  const collected = await collectAttachments(c.env, db, { files, mediaIds });
  if (!collected.ok) {
    return c.json({ error: collected.error }, 400);
  }
  const from = await getAdminFrom(db);

  try {
    await getEmailSender(c.env).send({
      to: fields.to,
      subject: fields.subject,
      ...(design ? buildDesignBodies(fields.bodyHtml) : buildBodies(fields.bodyHtml)),
      replyTo: fields.replyTo ?? (await getDefaultReplyTo(db, user.email)),
      ...(from ? { from } : {}),
      ...(collected.attachments.length ? { attachments: collected.attachments } : {}),
    });
  } catch (error) {
    console.error('Failed to send an admin email:', error);
    return c.json({ error: 'The email provider rejected or failed to send this message.' }, 502);
  }

  await recordAudit(db, {
    actorUserId: user.id,
    action: 'email.sent',
    targetType: 'email',
    metadata: { to: fields.to, subject: fields.subject, attachments: collected.attachments.length, design },
  });
  return c.json({ from: from ?? null }, 200);
});

// Returns exactly what a designed email would contain after sanitising, so the composer's preview
// shows the real result rather than the pasted markup. Stateless; admin/owner only.
emailRoute.post('/sanitize-preview', requireRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const html = body && typeof body === 'object' ? (body as { html?: unknown }).html : undefined;
  if (typeof html !== 'string' || html.length > 300_000) {
    return c.json({ error: 'html (string, max 300000 characters) is required' }, 400);
  }
  return c.json({ html: sanitizeEmailHtml(html) }, 200);
});

emailRoute.openAPIRegistry.registerPath({
  method: 'post',
  path: '/send',
  tags: ['Email'],
  summary: 'Send an email to any recipient from the CMS (editor and above)',
  description:
    'multipart/form-data with `to`, `subject`, `bodyHtml`, optional `replyTo`, any number of ' +
    '`files` (PDF, DOCX or image, verified by bytes) and `mediaIds` (Media Library items, read ' +
    'server-side). JSON without attachments is also accepted.',
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            to: z.string(),
            subject: z.string(),
            bodyHtml: z.string(),
            replyTo: z.string().optional(),
            designHtml: z.string().optional(),
            files: z.array(z.string().openapi({ type: 'string', format: 'binary' })).optional(),
            mediaIds: z.array(z.string()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Handed to the provider.', content: { 'application/json': { schema: z.object({ from: z.string().nullable() }) } } },
    400: { description: 'Invalid input, no provider, or attachments over limit.', content: { 'application/json': { schema: errorSchema } } },
    502: { description: 'The provider failed to send.', content: { 'application/json': { schema: errorSchema } } },
  },
});
