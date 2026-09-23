import type { EmailTemplateKey } from '@kenresoft-cms/contracts';

import { emailShell } from './shell';

export interface EmailTemplateDefault {
  key: EmailTemplateKey;
  name: string;
  description: string;
  subject: string;
  bodyHtml: string;
  // Every variable name this template's context actually supplies (render.ts) — surfaced in the
  // admin editor as a reference and used there to flag a `{{typo}}` before it ships. `design.*`
  // and `site.*` are NOT listed per-template: every template gets them for free (see
  // COMMON_VARIABLES below), so listing them on each one would just be repetition.
  variables: string[];
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

const emailVerificationDefault: EmailTemplateDefault = {
  key: 'email_verification',
  name: 'Email verification (website account)',
  description:
    'Sent when someone signs up on your public site (a Commerce customer, a form-gated area, or any other website account) and needs to confirm their email address before signing in.',
  subject: 'Verify your email address',
  variables: ['user.name', 'user.email', 'verificationUrl', 'expiresIn'],
  bodyHtml: emailShell({
    preheader: "You're almost there — verify your email to finish setting up your account.",
    heading: 'Verify your email address',
    bodyParagraphsHtml: `<p style="margin:0 0 8px 0; font-size:15px; line-height:1.6; color:{{design.textColor}};">Hi {{user.name}},</p>
              <p style="margin:0; font-size:15px; line-height:1.6; color:{{design.textColor}};">You're almost there. Verify your email address to finish setting up your account.</p>`,
    ctaLabel: 'Verify email',
    ctaUrl: '{{verificationUrl}}',
    fineprint: "This link expires in {{expiresIn}}. If you didn't create this account, you can safely ignore this email.",
  }),
};

const emailVerificationStaffDefault: EmailTemplateDefault = {
  key: 'email_verification_staff',
  name: 'Email verification (CMS staff)',
  description:
    'Sent to a new or existing CMS staff account (an Owner/Admin/Editor/Author/Viewer) that needs to verify their email before they can sign in to the admin.',
  subject: 'Verify your email — {{site.name}}',
  variables: ['user.name', 'user.email', 'verificationUrl', 'expiresIn'],
  bodyHtml: emailShell({
    preheader: 'Verify your email to finish setting up your CMS account.',
    heading: 'Verify your email address',
    bodyParagraphsHtml: `<p style="margin:0 0 8px 0; font-size:15px; line-height:1.6; color:{{design.textColor}};">Hi {{user.name}},</p>
              <p style="margin:0; font-size:15px; line-height:1.6; color:{{design.textColor}};">Verify your email address to finish setting up your {{site.name}} account. You won't be able to sign in until you do.</p>`,
    ctaLabel: 'Verify email',
    ctaUrl: '{{verificationUrl}}',
    fineprint: "This link expires in {{expiresIn}}. If you didn't expect this, you can safely ignore this email.",
  }),
};

const passwordResetDefault: EmailTemplateDefault = {
  key: 'password_reset',
  name: 'Password reset',
  description: 'Sent when a password reset is requested for an account, whether CMS staff or a website account.',
  subject: 'Reset your password',
  variables: ['user.name', 'user.email', 'resetUrl', 'expiresIn'],
  bodyHtml: emailShell({
    preheader: 'Someone requested a password reset for your account.',
    heading: 'Reset your password',
    bodyParagraphsHtml: `<p style="margin:0 0 8px 0; font-size:15px; line-height:1.6; color:{{design.textColor}};">Hi {{user.name}},</p>
              <p style="margin:0; font-size:15px; line-height:1.6; color:{{design.textColor}};">Someone requested a password reset for your account. If this was you, choose a new password below.</p>`,
    ctaLabel: 'Reset password',
    ctaUrl: '{{resetUrl}}',
    fineprint: "This link expires in {{expiresIn}}. If you didn't request this, you can safely ignore this email — your password won't change.",
  }),
};

export const EMAIL_TEMPLATE_DEFAULTS: Record<EmailTemplateKey, EmailTemplateDefault> = {
  email_verification: emailVerificationDefault,
  email_verification_staff: emailVerificationStaffDefault,
  password_reset: passwordResetDefault,
};

export function getEmailTemplateDefault(key: EmailTemplateKey): EmailTemplateDefault {
  return EMAIL_TEMPLATE_DEFAULTS[key];
}
