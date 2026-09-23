import { createRoute } from '@hono/zod-openapi';
import {
  emailTemplateKeySchema,
  emailTemplatePreviewResultSchema,
  emailTemplateSchema,
  previewEmailTemplateSchema,
  sendTestEmailTemplateSchema,
  updateEmailTemplateSchema,
} from '@kenresoft-cms/contracts';
import type { EmailTemplate, EmailTemplateKey } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { COMMON_VARIABLES, getEmailTemplateDefault } from '../../lib/email-templates/defaults';
import { buildCommonTemplateContext } from '../../lib/email-templates/context';
import { renderEmailTemplate } from '../../lib/email-templates/render';
import { buildSampleVariables } from '../../lib/email-templates/sample-data';
import { getEmailSender, isEmailProviderConfigured } from '../../lib/email';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import {
  getEmailTemplateByKey,
  listEmailTemplates,
  restoreEmailTemplateDefault,
  updateEmailTemplate,
} from '../../repositories/email-templates';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type { EmailTemplate as DbEmailTemplate } from '@kenresoft-cms/database';

export const emailTemplatesRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

emailTemplatesRoute.use('*', requireRole('admin'));

const notFoundSchema = z.object({ error: z.string() });
const keyParamSchema = z.object({ key: emailTemplateKeySchema });

function toEmailTemplate(row: DbEmailTemplate): EmailTemplate {
  const def = getEmailTemplateDefault(row.key);
  const isCustomized = row.subject !== def.subject || row.bodyHtml !== def.bodyHtml || row.plainText !== null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    subject: row.subject,
    bodyHtml: row.bodyHtml,
    plainText: row.plainText,
    enabled: row.enabled,
    isCustomized,
    availableVariables: [...def.variables, ...COMMON_VARIABLES],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

emailTemplatesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Email templates'],
    summary: 'List every transactional email template (admin only)',
    responses: {
      200: {
        description: 'Every known template — always exactly EMAIL_TEMPLATE_KEYS.length rows, seeded on first access.',
        content: { 'application/json': { schema: z.array(emailTemplateSchema) } },
      },
    },
  }),
  async (c) => c.json((await listEmailTemplates(getDb(c))).map(toEmailTemplate), 200),
);

emailTemplatesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{key}',
    tags: ['Email templates'],
    summary: 'Get one transactional email template (admin only)',
    request: { params: keyParamSchema },
    responses: {
      200: { description: 'The template.', content: { 'application/json': { schema: emailTemplateSchema } } },
    },
  }),
  async (c) => {
    const { key } = c.req.valid('param');
    const row = await getEmailTemplateByKey(getDb(c), key);
    return c.json(toEmailTemplate(row!), 200);
  },
);

emailTemplatesRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{key}',
    tags: ['Email templates'],
    summary: 'Update a transactional email template (admin only)',
    request: {
      params: keyParamSchema,
      body: { content: { 'application/json': { schema: updateEmailTemplateSchema } } },
    },
    responses: {
      200: { description: 'The updated template.', content: { 'application/json': { schema: emailTemplateSchema } } },
    },
  }),
  async (c) => {
    const { key } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = getDb(c);
    const updated = await updateEmailTemplate(db, key, input);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'email_template.updated',
      targetType: 'email_template',
      targetId: key,
      metadata: { enabled: updated!.enabled },
    });
    return c.json(toEmailTemplate(updated!), 200);
  },
);

emailTemplatesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/{key}/restore-default',
    tags: ['Email templates'],
    summary: "Reset a template's subject/HTML/plain-text back to the shipped default (admin only)",
    request: { params: keyParamSchema },
    responses: {
      200: { description: 'The restored template.', content: { 'application/json': { schema: emailTemplateSchema } } },
    },
  }),
  async (c) => {
    const { key } = c.req.valid('param');
    const db = getDb(c);
    const restored = await restoreEmailTemplateDefault(db, key);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'email_template.restored_default',
      targetType: 'email_template',
      targetId: key,
    });
    return c.json(toEmailTemplate(restored!), 200);
  },
);

// Renders the *given* (possibly unsaved) subject/bodyHtml/plainText against realistic sample
// data plus the deployment's real current site/design tokens — never writes anything, so an
// admin can preview an edit before deciding to save it.
emailTemplatesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/{key}/preview',
    tags: ['Email templates'],
    summary: 'Render a (possibly unsaved) template body against sample data (admin only)',
    request: {
      params: keyParamSchema,
      body: { content: { 'application/json': { schema: previewEmailTemplateSchema } } },
    },
    responses: {
      200: {
        description: 'The rendered subject/HTML/plain-text.',
        content: { 'application/json': { schema: emailTemplatePreviewResultSchema } },
      },
    },
  }),
  async (c) => {
    const { key } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = getDb(c);
    const variables = { ...(await buildCommonTemplateContext(db, c.env)), ...buildSampleVariables(key as EmailTemplateKey) };
    const rendered = renderEmailTemplate(
      { subject: input.subject, bodyHtml: input.bodyHtml, plainText: input.plainText ?? null },
      variables,
    );
    return c.json(rendered, 200);
  },
);

emailTemplatesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/{key}/send-test',
    tags: ['Email templates'],
    summary: 'Send the currently saved template to a test recipient, using sample data (admin only)',
    request: {
      params: keyParamSchema,
      body: { content: { 'application/json': { schema: sendTestEmailTemplateSchema } } },
    },
    responses: {
      200: { description: 'Sent.', content: { 'application/json': { schema: z.object({ sent: z.boolean() }) } } },
      400: {
        description: 'No email provider is configured for this deployment.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    if (!isEmailProviderConfigured(c.env)) {
      return c.json({ error: 'This deployment has no email provider configured.' }, 400);
    }
    const { key } = c.req.valid('param');
    const { to } = c.req.valid('json');
    const db = getDb(c);
    const template = await getEmailTemplateByKey(db, key);
    const variables = { ...(await buildCommonTemplateContext(db, c.env)), ...buildSampleVariables(key as EmailTemplateKey) };
    const rendered = renderEmailTemplate(template!, variables);

    await getEmailSender(c.env).send({
      to,
      subject: `[Test] ${rendered.subject}`,
      html: `<p style="background:#fef3c7; color:#92400e; padding:8px 12px; border-radius:6px; font-family:sans-serif; font-size:13px;">This is a test send of the "${template!.name}" template — no real action was taken.</p>${rendered.html}`,
      text: `THIS IS A TEST SEND of the "${template!.name}" template — no real action was taken.\n\n${rendered.text}`,
    });

    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'email_template.test_sent',
      targetType: 'email_template',
      targetId: key,
      metadata: { to },
    });
    return c.json({ sent: true }, 200);
  },
);
