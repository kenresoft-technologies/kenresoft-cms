import { z } from 'zod';

import { EMAIL_DESIGN_IDS, EMAIL_TEMPLATE_KEYS, EMAIL_TEMPLATE_MODES } from './enums';

export const emailTemplateKeySchema = z.enum(EMAIL_TEMPLATE_KEYS);
export const emailTemplateModeSchema = z.enum(EMAIL_TEMPLATE_MODES);
export const emailDesignIdSchema = z.enum(EMAIL_DESIGN_IDS);

// The structured-mode content of one system email — the only thing a non-technical admin edits
// in Standard mode. No HTML, no `{{variable}}` syntax: the greeting ("Hi {{user.name}},") and
// the CTA's own destination link are structural, filled in automatically by the chosen design
// (apps/api/src/lib/email-templates/designs.ts) — never part of what's stored/edited here.
export const emailTemplateContentSchema = z.object({
  heading: z.string().min(1).max(200),
  bodyText: z.string().min(1).max(2000),
  ctaLabel: z.string().min(1).max(60),
  fineprint: z.string().min(1).max(500),
});

export type EmailTemplateContent = z.infer<typeof emailTemplateContentSchema>;

export const emailTemplateSchema = z.object({
  id: z.string(),
  key: emailTemplateKeySchema,
  name: z.string(),
  description: z.string(),
  subject: z.string(),
  mode: emailTemplateModeSchema,
  // Standard-mode content — always present (backfilled from the shipped default the first time
  // a legacy row is read), even while `mode === 'developer'`, so switching a template back to
  // Standard has something sensible to start from instead of blank fields.
  content: emailTemplateContentSchema,
  // Developer-mode source. Present for every template (mirrors `content` the same way), but
  // only meaningful — and only ever sent to a real recipient — while `mode === 'developer'`.
  bodyHtml: z.string(),
  plainText: z.string().nullable(),
  enabled: z.boolean(),
  // Whether the template still matches what ships with the CMS — compares `content`+`subject`
  // in Standard mode, `bodyHtml`+`subject`+`plainText` in Developer mode. Computed at read time,
  // never stored.
  isCustomized: z.boolean(),
  // Variable names available if this template is switched to Developer mode — e.g. "user.name",
  // "verificationUrl" — used there as a reference and to flag an unknown {{...}} token in the
  // editor before save. Not relevant to (and not shown in) Standard mode, which has no {{}} at
  // all.
  availableVariables: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

// Every field optional — an admin PATCH updates whichever subset it's touching (toggling
// `enabled` alone, switching `mode` alone, editing `content` alone, ...). Hand-written rather
// than `emailTemplateSchema.pick({...}).partial()`: none of these fields has a `.default(...)`
// today, but per this codebase's own precedent (Site Builder Phase 10's hardening pass), a
// future one easily could — new update schemas skip that trap from day one.
export const updateEmailTemplateSchema = z.object({
  subject: z.string().min(1).max(300).optional(),
  mode: emailTemplateModeSchema.optional(),
  // Standard mode's edit surface.
  content: emailTemplateContentSchema.optional(),
  // Developer mode's edit surface.
  bodyHtml: z.string().min(1).max(300_000).optional(),
  // Explicit null clears a hand-written plain-text override back to "derive it from the
  // rendered HTML"; omitted leaves whatever is currently stored untouched. Applies to both modes.
  plainText: z.string().max(50_000).nullable().optional(),
  enabled: z.boolean().optional(),
});

export type UpdateEmailTemplateInput = z.infer<typeof updateEmailTemplateSchema>;

// Renders *given* (possibly unsaved) content against realistic mock data and the deployment's
// real current branding — the admin editor's live preview in both modes, and what "Restore
// default" previews before committing. Never touches what's actually configured. A discriminated
// union on `mode` rather than one loose object with every field optional: which fields are
// required genuinely differs by mode (content vs. bodyHtml), and this makes an inconsistent
// request (e.g. `mode: 'standard'` with a `bodyHtml`) rejected by the schema itself rather than
// silently ignored by the handler.
export const previewEmailTemplateSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('standard'),
    subject: z.string().min(1).max(300),
    content: emailTemplateContentSchema,
    plainText: z.string().max(50_000).nullable().optional(),
    // Optional override of the deployment's currently-active design — used only by the design
    // gallery's own "preview this design before switching to it" flow (which design a template
    // renders through is otherwise a single global choice, not set per preview call). Omitted,
    // a per-template editor's preview uses whatever's actually active.
    designId: emailDesignIdSchema.optional(),
  }),
  z.object({
    mode: z.literal('developer'),
    subject: z.string().min(1).max(300),
    bodyHtml: z.string().min(1).max(300_000),
    plainText: z.string().max(50_000).nullable().optional(),
  }),
]);

export type PreviewEmailTemplateInput = z.infer<typeof previewEmailTemplateSchema>;

export const emailTemplatePreviewResultSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});

export type EmailTemplatePreviewResult = z.infer<typeof emailTemplatePreviewResultSchema>;

export const sendTestEmailTemplateSchema = z.object({
  to: z.string().email(),
});

// Static registry metadata for the built-in designs (apps/api/src/lib/email-templates/
// designs.ts is the source of truth; this is just what the admin gallery needs to render cards).
export const emailDesignSchema = z.object({
  id: emailDesignIdSchema,
  name: z.string(),
  description: z.string(),
});

export type EmailDesign = z.infer<typeof emailDesignSchema>;
