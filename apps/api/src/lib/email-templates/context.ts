import type { EmailBrandingSettingsData, GeneralSettingsData } from '@kenresoft-cms/contracts';
import type { Database } from '@kenresoft-cms/database';

import { getSettings } from '../../repositories/settings';
import { getStructuredSettings } from '../../repositories/structured-settings';
import type { Bindings } from '../env';
import type { TemplateVariables } from './render';

// Kenresoft's own default design tokens — used whenever the emailBranding Structured Settings
// module has never been saved, or a field within it is still null, so every deployment has a
// real, on-brand-looking email from the moment it can send its first one, no setup required
// (matching this codebase's "opt-in infrastructure, not a hard dependency" stance for
// EMAIL_PROVIDER/Turnstile/etc.). "Premium, modern, technical, restrained, trustworthy" — a
// dark navy/indigo identity, not a generic corporate blue.
const DEFAULT_DESIGN_TOKENS = {
  brandColor: '#6366f1',
  pageBackground: '#0f1117',
  contentBackground: '#171a23',
  textColor: '#e5e7eb',
  mutedTextColor: '#9099ab',
  buttonTextColor: '#ffffff',
  borderColor: '#262b38',
  fontStack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  contentWidth: '520px',
} as const;

// Merges the emailBranding Structured Settings module (an admin's own overrides) over the
// defaults above — every field is independently nullable, so setting only `brandColor` doesn't
// require re-specifying every other token. `siteName` is passed in already resolved (not a
// `{{site.name}}` token inside the default footer text) — substitution is a single pass over
// the template, so a token embedded inside another variable's own value would never itself get
// replaced, just appear literally in the output.
async function resolveDesignTokens(db: Database, siteName: string): Promise<Record<string, string>> {
  const row = await getStructuredSettings(db, 'emailBranding');
  const data = (row?.data as Partial<EmailBrandingSettingsData> | undefined) ?? {};
  return {
    'design.brandColor': data.brandColor ?? DEFAULT_DESIGN_TOKENS.brandColor,
    'design.pageBackground': data.pageBackground ?? DEFAULT_DESIGN_TOKENS.pageBackground,
    'design.contentBackground': data.contentBackground ?? DEFAULT_DESIGN_TOKENS.contentBackground,
    'design.textColor': data.textColor ?? DEFAULT_DESIGN_TOKENS.textColor,
    'design.mutedTextColor': data.mutedTextColor ?? DEFAULT_DESIGN_TOKENS.mutedTextColor,
    'design.buttonTextColor': data.buttonTextColor ?? DEFAULT_DESIGN_TOKENS.buttonTextColor,
    'design.borderColor': DEFAULT_DESIGN_TOKENS.borderColor,
    'design.fontStack': DEFAULT_DESIGN_TOKENS.fontStack,
    'design.contentWidth': DEFAULT_DESIGN_TOKENS.contentWidth,
    'design.footerText': data.footerText ?? `Sent by ${siteName}. If you weren’t expecting this email, you can ignore it.`,
  };
}

function resolveSiteUrl(env: Pick<Bindings, 'ADMIN_URL' | 'CORS_ORIGINS'>): string {
  return env.ADMIN_URL ?? env.CORS_ORIGINS.split(',')[0]?.trim() ?? '';
}

// The variables common to every template (defaults.ts's COMMON_VARIABLES) — site identity,
// support contact, and every design token. Call-site-specific variables (user.name,
// verificationUrl, ...) are merged in on top by each send call site.
export async function buildCommonTemplateContext(db: Database, env: Bindings): Promise<TemplateVariables> {
  const [general, contact, settings] = await Promise.all([
    getStructuredSettings(db, 'general'),
    getStructuredSettings(db, 'contact'),
    getSettings(db),
  ]);
  const generalData = general?.data as Partial<GeneralSettingsData> | undefined;
  const contactEmail = (contact?.data as { email?: string | null } | undefined)?.email;
  const siteName = generalData?.siteName ?? settings?.name ?? 'Kenresoft CMS';
  const designTokens = await resolveDesignTokens(db, siteName);

  return {
    'site.name': siteName,
    'site.url': resolveSiteUrl(env),
    'support.email': contactEmail ?? '',
    ...designTokens,
  };
}
