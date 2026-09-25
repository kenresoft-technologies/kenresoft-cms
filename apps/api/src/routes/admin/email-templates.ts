import { createRoute } from '@hono/zod-openapi';
import {
  emailDesignSchema,
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
import { listEmailDesigns } from '../../lib/email-templates/designs';
import { renderEmailTemplate } from '../../lib/email-templates/render';
import { renderStandardModeBodyHtml } from '../../lib/email-templates/standard-render';
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

// A legacy row (mode still null — see repositories/email-templates.ts's resolveLegacyMode) is
// always resolved by the repository before it reaches a route handler, so `row.mode` is never
// actually null by the time toEmailTemplate runs; this fallback exists only so the type checker
// (the DB column itself is nullable) doesn't need an assertion.
function toEmailTemplate(row: DbEmailTemplate): EmailTemplate {
  const def = getEmailTemplateDefault(row.key);
  const mode = row.mode ?? 'developer';
  const content = {
    heading: row.heading ?? def.content.heading,
    bodyText: row.bodyText ?? def.content.bodyText,
    ctaLabel: row.ctaLabel ?? def.content.ctaLabel,
    fineprint: row.fineprint ?? def.content.fineprint,
  };
  const isCustomized =
    mode === 'standard'
      ? row.subject !== def.subject ||
        content.heading !== def.content.heading ||
        content.bodyText !== def.content.bodyText ||
        content.ctaLabel !== def.content.ctaLabel ||
        content.fineprint !== def.content.fineprint
      : row.subject !== def.subject || row.bodyHtml !== def.bodyHtml || row.plainText !== null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    subject: row.subject,
    mode,
    content,
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

// Static registry metadata for the Standard-mode design gallery — no DB, no auth beyond the
// route group's own requireRole('admin').
emailTemplatesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/designs',
    tags: ['Email templates'],
    summary: 'List the built-in email designs (admin only)',
    responses: {
      200: { description: 'The design registry.', content: { 'application/json': { schema: z.array(emailDesignSchema) } } },
    },
  }),
  (c) => c.json(listEmailDesigns(), 200),
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
      metadata: { enabled: updated!.enabled, mode: updated!.mode },
    });
    return c.json(toEmailTemplate(updated!), 200);
  },
);

emailTemplatesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/{key}/restore-default',
    tags: ['Email templates'],
    summary: "Reset a template's content back to the shipped default (admin only)",
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

// Renders the *given* (possibly unsaved) content against realistic sample data plus the
// deployment's real current branding — never writes anything, so an admin can preview an edit
// (or, with `designId` set, a candidate design from the gallery) before deciding to save it. In
// Standard mode this goes through exactly the same renderStandardModeBodyHtml() call a real send
// uses; in Developer mode it's the same substitute-and-sanitize pass it always was.
emailTemplatesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/{key}/preview',
    tags: ['Email templates'],
    summary: 'Render a (possibly unsaved) template against sample data (admin only)',
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
    const bodyHtml =
      input.mode === 'standard'
        ? await renderStandardModeBodyHtml(db, c.env, key as EmailTemplateKey, input.content, input.designId)
        : input.bodyHtml;
    const rendered = renderEmailTemplate({ subject: input.subject, bodyHtml, plainText: input.plainText ?? null }, variables);
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
    const row = await getEmailTemplateByKey(db, key);
    const template = toEmailTemplate(row!);
    const variables = { ...(await buildCommonTemplateContext(db, c.env)), ...buildSampleVariables(key as EmailTemplateKey) };
    const bodyHtml =
      template.mode === 'standard' ? await renderStandardModeBodyHtml(db, c.env, key, template.content) : template.bodyHtml;
    const rendered = renderEmailTemplate({ subject: template.subject, bodyHtml, plainText: template.plainText }, variables);

    await getEmailSender(c.env).send({
      to,
      subject: `[Test] ${rendered.subject}`,
      html: `<p style="background:#fef3c7; color:#92400e; padding:8px 12px; border-radius:6px; font-family:sans-serif; font-size:13px;">This is a test send of the "${template.name}" template — no real action was taken.</p>${rendered.html}`,
      text: `THIS IS A TEST SEND of the "${template.name}" template — no real action was taken.\n\n${rendered.text}`,
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
