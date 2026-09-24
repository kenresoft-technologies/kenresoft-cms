import type { EmailBrandingSettingsData, EmailDesignId, EmailTemplateContent, EmailTemplateKey, GeneralSettingsData } from '@kenresoft-cms/contracts';
import type { Database } from '@kenresoft-cms/database';

import { getStructuredSettings } from '../../repositories/structured-settings';
import type { Bindings } from '../env';
import { buildBodyParagraphsHtml } from './content-builder';
import { DEFAULT_DESIGN_ID, getEmailDesign } from './designs';
import { escapeHtml } from './render';
import { getEmailTemplateDefault } from './defaults';

// Resolves the one design every system email renders through right now — a single, deployment-
// wide choice (emailBranding.designId), not chosen per template key. Exported so both the
// per-template preview (which uses whatever's actually active) and the design gallery's own
// "preview a design before switching to it" flow (which passes an explicit override instead of
// calling this) share one source of truth for "what's active today".
export async function resolveActiveDesignId(db: Database): Promise<EmailDesignId> {
  const row = await getStructuredSettings(db, 'emailBranding');
  const data = row?.data as Partial<EmailBrandingSettingsData> | undefined;
  return data?.designId ?? DEFAULT_DESIGN_ID;
}

// A deployment's own emailBranding.logoMediaId, falling back to the public-site general.logoMediaId
// (a square admin-sidebar/public-site logo is often close enough for a transactional email if a
// deployment never set a dedicated one) — resolved to a real, publicly fetchable URL via the API's
// own public media route, or null if neither is set, in which case every design falls back to a
// text wordmark instead of an <img>.
export async function resolveLogoUrl(db: Database, env: Pick<Bindings, 'BETTER_AUTH_URL'>): Promise<string | null> {
  const [emailBranding, general] = await Promise.all([
    getStructuredSettings(db, 'emailBranding'),
    getStructuredSettings(db, 'general'),
  ]);
  const emailBrandingData = emailBranding?.data as Partial<EmailBrandingSettingsData> | undefined;
  const generalData = general?.data as Partial<GeneralSettingsData> | undefined;
  const mediaId = emailBrandingData?.logoMediaId ?? generalData?.logoMediaId ?? null;
  return mediaId ? `${env.BETTER_AUTH_URL}/api/v1/public/media/${mediaId}/file` : null;
}

// Builds real bodyHtml (still carrying `{{design.*}}`/`{{site.name}}`/call-site tokens, exactly
// like a Developer-mode template's stored bodyHtml does) from Standard mode's structured
// content — the one function both a real send (send.ts) and a live preview (routes/admin/
// email-templates.ts) call, so what an admin previews is produced by literally the same code
// path as what a real recipient gets, not a parallel approximation of it. `heading`/`ctaLabel`
// are escaped here (admin-supplied free text); `bodyText` is escaped inside
// buildBodyParagraphsHtml; `fineprint` is passed through un-escaped only because every current
// default's fineprint intentionally contains a real `{{expiresIn}}` token — see
// updateEmailTemplateSchema's own docs for why Standard mode still tolerates (never requires) a
// `{{}}` token in that one field.
export async function renderStandardModeBodyHtml(
  db: Database,
  env: Pick<Bindings, 'BETTER_AUTH_URL'>,
  key: EmailTemplateKey,
  content: EmailTemplateContent,
  designIdOverride?: EmailDesignId,
): Promise<string> {
  const [designId, logoUrl] = await Promise.all([
    designIdOverride ? Promise.resolve(designIdOverride) : resolveActiveDesignId(db),
    resolveLogoUrl(db, env),
  ]);
  const design = getEmailDesign(designId);
  const def = getEmailTemplateDefault(key);
  return design.render({
    preheader: content.heading,
    logoUrl,
    heading: escapeHtml(content.heading),
    bodyParagraphsHtml: buildBodyParagraphsHtml(content.bodyText),
    ctaLabel: escapeHtml(content.ctaLabel),
    ctaUrl: `{{${def.primaryCtaVariable}}}`,
    fineprint: content.fineprint,
  });
}
