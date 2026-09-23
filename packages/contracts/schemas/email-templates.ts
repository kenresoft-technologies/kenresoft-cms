import { z } from 'zod';

import { EMAIL_TEMPLATE_KEYS } from './enums';

export const emailTemplateKeySchema = z.enum(EMAIL_TEMPLATE_KEYS);

export const emailTemplateSchema = z.object({
  id: z.string(),
  key: emailTemplateKeySchema,
  name: z.string(),
  description: z.string(),
  subject: z.string(),
  bodyHtml: z.string(),
  plainText: z.string().nullable(),
  enabled: z.boolean(),
  // Whether the current subject/bodyHtml/plainText still match what ships with the CMS —
  // computed by the API at read time (apps/api/src/lib/email-templates/defaults.ts), not
  // stored, so it can never drift from the truth.
  isCustomized: z.boolean(),
  // The variable names this template's context actually supplies (apps/api/src/lib/
  // email-templates/defaults.ts) — e.g. "user.name", "verificationUrl" — shown in the admin
  // editor as a reference, and used to flag an unknown {{...}} token in the editor before save.
  availableVariables: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

// Subject/bodyHtml/plainText/enabled only — key/name/description/availableVariables are fixed
// per template (this isn't a free-form template registry, see EMAIL_TEMPLATE_KEYS's own
// comment), and isCustomized is derived, never written. Hand-written rather than
// emailTemplateSchema.pick({...}).partial(): none of these three fields has a `.default(...)`
// today, but a future one easily could, and every `.partial()`-of-a-create/full-schema in this
// codebase that started that way eventually got bitten by exactly that trap once its base
// schema gained a default (Site Builder Phase 10's hardening pass) — new update schemas skip it
// from day one.
export const updateEmailTemplateSchema = z.object({
  subject: z.string().min(1).max(300).optional(),
  bodyHtml: z.string().min(1).max(300_000).optional(),
  // Explicit null clears a hand-written plain-text override back to "derive it from bodyHtml";
  // omitted leaves whatever is currently stored untouched.
  plainText: z.string().max(50_000).nullable().optional(),
  enabled: z.boolean().optional(),
});

export type UpdateEmailTemplateInput = z.infer<typeof updateEmailTemplateSchema>;

// Renders a template's *current stored content* against realistic mock data — the admin
// editor's live preview, and also what "Restore default" previews before committing. Never
// touches what's actually configured; a preview call has no side effects.
export const previewEmailTemplateSchema = z.object({
  subject: z.string().min(1).max(300),
  bodyHtml: z.string().min(1).max(300_000),
  plainText: z.string().max(50_000).nullable().optional(),
});

export const emailTemplatePreviewResultSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});

export type EmailTemplatePreviewResult = z.infer<typeof emailTemplatePreviewResultSchema>;

export const sendTestEmailTemplateSchema = z.object({
  to: z.string().email(),
});
