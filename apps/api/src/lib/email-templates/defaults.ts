import type { EmailTemplateContent, EmailTemplateKey } from '@kenresoft-cms/contracts';

import { buildBodyParagraphsHtml } from './content-builder';
import { DEFAULT_DESIGN_ID, getEmailDesign } from './designs';
import { escapeHtml } from './render';

export interface EmailTemplateDefault {
  key: EmailTemplateKey;
  name: string;
  description: string;
  subject: string;
  // Standard mode's shipped content — heading/body text/CTA label/fine print, no HTML, no
  // {{}} syntax (the greeting and the CTA's own link are structural, see content-builder.ts and
  // primaryCtaVariable below). This is the source of truth; `bodyHtml` below is derived from it.
  content: EmailTemplateContent;
  // Which of this template's own call-site variables (send.ts) the CTA button links to — fixed
  // per email type, never admin-editable (a non-technical admin edits the button's *label*, not
  // which link it points to). 'expiresIn' isn't listed here since every current template's
  // fine print already references it the same way.
  primaryCtaVariable: 'verificationUrl' | 'resetUrl';
  // Every variable name this template's context actually supplies (render.ts) — surfaced in the
  // Developer-mode editor as a reference and used there to flag a `{{typo}}` before it ships.
  // `design.*` and `site.*` are NOT listed per-template: every template gets them for free (see
  // COMMON_VARIABLES below), so listing them on each one would just be repetition. Not shown in
  // Standard mode, which has no {{}} at all.
  variables: string[];
  // Computed from `content` via the default (Modern Minimal) design — the seed value for a
  // fresh row (repositories/email-templates.ts's ensureSeeded), the fallback used if rendering
  // ever fails (send.ts), and what a legacy (pre-mode-column) row is compared against to decide
  // whether it was ever customized (repositories/email-templates.ts's resolveLegacyMode).
  bodyHtml: string;
}

// Supplied to every template's render context automatically (apps/api/src/lib/email-templates/
// context.ts merges these in) — design tokens from the emailBranding Structured Settings module
// (docs/ARCHITECTURE.md §6.2) and basic site identity, so no individual template definition has
// to know where its own branding data comes from.
export const COMMON_VARIABLES = [
  'site.name',
  'site.url',
  'support.email',
  'design.brandColor',
  'design.pageBackground',
  'design.contentBackground',
  'design.textColor',
  'design.mutedTextColor',
  'design.buttonTextColor',
  'design.borderColor',
  'design.fontStack',
  'design.contentWidth',
  'design.footerText',
] as const;

function buildDefaultBodyHtml(content: EmailTemplateContent, ctaUrlToken: string, preheader: string): string {
  const design = getEmailDesign(DEFAULT_DESIGN_ID);
  return design.render({
    preheader,
    logoUrl: null,
    heading: escapeHtml(content.heading),
    bodyParagraphsHtml: buildBodyParagraphsHtml(content.bodyText),
    ctaLabel: escapeHtml(content.ctaLabel),
    ctaUrl: ctaUrlToken,
    fineprint: content.fineprint,
  });
}

const emailVerificationContent: EmailTemplateContent = {
  heading: 'Verify your email address',
  bodyText: "You're almost there. Verify your email address to finish setting up your account.",
  ctaLabel: 'Verify email',
  fineprint: "This link expires in {{expiresIn}}. If you didn't create this account, you can safely ignore this email.",
};

const emailVerificationDefault: EmailTemplateDefault = {
  key: 'email_verification',
  name: 'Email verification (website account)',
  description:
    'Sent when someone signs up on your public site (a Commerce customer, a form-gated area, or any other website account) and needs to confirm their email address before signing in.',
  subject: 'Verify your email address',
  content: emailVerificationContent,
  primaryCtaVariable: 'verificationUrl',
  variables: ['user.name', 'user.email', 'verificationUrl', 'expiresIn'],
  bodyHtml: buildDefaultBodyHtml(
    emailVerificationContent,
    '{{verificationUrl}}',
    "You're almost there — verify your email to finish setting up your account.",
  ),
};

const emailVerificationStaffContent: EmailTemplateContent = {
  heading: 'Verify your email address',
  bodyText: "Verify your email address to finish setting up your {{site.name}} account. You won't be able to sign in until you do.",
  ctaLabel: 'Verify email',
  fineprint: "This link expires in {{expiresIn}}. If you didn't expect this, you can safely ignore this email.",
};

const emailVerificationStaffDefault: EmailTemplateDefault = {
  key: 'email_verification_staff',
  name: 'Email verification (CMS staff)',
  description:
    'Sent to a new or existing CMS staff account (an Owner/Admin/Editor/Author/Viewer) that needs to verify their email before they can sign in to the admin.',
  subject: 'Verify your email — {{site.name}}',
  content: emailVerificationStaffContent,
  primaryCtaVariable: 'verificationUrl',
  variables: ['user.name', 'user.email', 'verificationUrl', 'expiresIn'],
  bodyHtml: buildDefaultBodyHtml(
    emailVerificationStaffContent,
    '{{verificationUrl}}',
    'Verify your email to finish setting up your CMS account.',
  ),
};

const passwordResetContent: EmailTemplateContent = {
  heading: 'Reset your password',
  bodyText: "Someone requested a password reset for your account. If this was you, choose a new password below.",
  ctaLabel: 'Reset password',
  fineprint: "This link expires in {{expiresIn}}. If you didn't request this, you can safely ignore this email — your password won't change.",
};

const passwordResetDefault: EmailTemplateDefault = {
  key: 'password_reset',
  name: 'Password reset',
  description: 'Sent when a password reset is requested for an account, whether CMS staff or a website account.',
  subject: 'Reset your password',
  content: passwordResetContent,
  primaryCtaVariable: 'resetUrl',
  variables: ['user.name', 'user.email', 'resetUrl', 'expiresIn'],
  bodyHtml: buildDefaultBodyHtml(
    passwordResetContent,
    '{{resetUrl}}',
    'Someone requested a password reset for your account.',
  ),
};

export const EMAIL_TEMPLATE_DEFAULTS: Record<EmailTemplateKey, EmailTemplateDefault> = {
  email_verification: emailVerificationDefault,
  email_verification_staff: emailVerificationStaffDefault,
  password_reset: passwordResetDefault,
};

export function getEmailTemplateDefault(key: EmailTemplateKey): EmailTemplateDefault {
  return EMAIL_TEMPLATE_DEFAULTS[key];
}
