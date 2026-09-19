import { createRoute, z } from '@hono/zod-openapi';
import { sendAdminEmailSchema } from '@kenresoft-cms/contracts';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { getAdminFrom } from '../../lib/email/admin-sender';
import { getEmailSender, isEmailProviderConfigured } from '../../lib/email';
import { htmlToPlainText } from '../../lib/html-to-text';
import { sanitizeReplyHtml } from '../../lib/html-sanitizer';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

export const emailRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const errorSchema = z.object({ error: z.string() });

// Sends from Settings' configured sender identity (falling back to EMAIL_FROM), with Reply-To
// pointing at the staff member's real mailbox. No mailbox access of any kind is needed.
emailRoute.openapi(
  createRoute({
    method: 'post',
    path: '/send',
    tags: ['Email'],
    summary: 'Send an email to any recipient from the CMS (editor and above)',
    middleware: requireRole('admin', 'editor'),
    request: { body: { content: { 'application/json': { schema: sendAdminEmailSchema } } } },
    responses: {
      200: {
        description: 'The message was handed to the email provider.',
        content: { 'application/json': { schema: z.object({ from: z.string().nullable() }) } },
      },
      400: { description: 'No email provider configured.', content: { 'application/json': { schema: errorSchema } } },
      502: { description: 'The provider failed to send.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    if (!isEmailProviderConfigured(c.env)) {
      return c.json({ error: 'This deployment has no email provider configured.' }, 400);
    }
    const db = getDb(c);
    const user = c.get('user');
    const { to, subject, bodyHtml: rawBody, replyTo } = c.req.valid('json');
    const bodyHtml = sanitizeReplyHtml(rawBody);
    const from = await getAdminFrom(db);

    try {
      await getEmailSender(c.env).send({
        to,
        subject,
        html: bodyHtml,
        text: htmlToPlainText(bodyHtml),
        replyTo: replyTo ?? user.email,
        ...(from ? { from } : {}),
      });
    } catch (error) {
      console.error('Failed to send an admin email:', error);
      return c.json({ error: 'The email provider rejected or failed to send this message.' }, 502);
    }

    await recordAudit(db, {
      actorUserId: user.id,
      action: 'email.sent',
      targetType: 'email',
      metadata: { to, subject },
    });
    return c.json({ from: from ?? null }, 200);
  },
);
