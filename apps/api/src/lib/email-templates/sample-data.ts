import type { EmailTemplateKey } from '@kenresoft-cms/contracts';

import type { TemplateVariables } from './render';

// Realistic mock data for a template's own call-site-specific variables (defaults.ts's
// per-template `variables` list) — used by both the admin preview and "Send test email", so
// what an admin sees before saving is what a real send would actually look like once the real
// user.*/verificationUrl/etc. values are substituted in. Deliberately never a real user's own
// verification/reset token — see previewEmailTemplateSchema/sendTestEmailTemplateSchema's own
// comments for why.
export function buildSampleVariables(key: EmailTemplateKey): TemplateVariables {
  switch (key) {
    case 'email_verification':
      return {
        'user.name': 'Jane Doe',
        'user.email': 'jane@example.com',
        verificationUrl: 'https://example.com/verify-email?token=sample-preview-token',
        expiresIn: '1 hour',
      };
    case 'email_verification_staff':
      return {
        'user.name': 'Jane Doe',
        'user.email': 'jane@example.com',
        verificationUrl: 'https://admin.example.com/verify-email?token=sample-preview-token',
        expiresIn: '1 hour',
      };
    case 'password_reset':
      return {
        'user.name': 'Jane Doe',
        'user.email': 'jane@example.com',
        resetUrl: 'https://example.com/reset-password?token=sample-preview-token',
        expiresIn: '1 hour',
      };
  }
}
