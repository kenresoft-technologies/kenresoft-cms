import {
  contactSettingsDataSchema,
  footerSettingsDataSchema,
  generalSettingsDataSchema,
  socialLinkSchema,
  socialSettingsDataSchema,
  KNOWN_SOCIAL_PLATFORMS,
  STRUCTURED_SETTINGS_MODULES,
} from '@kenresoft-cms/contracts';
import type { LegacyMigrationReport, SocialLink, StructuredSettingsModule } from '@kenresoft-cms/contracts';
import type { Database } from '@kenresoft-cms/database';

import { listGlobalVariables } from '../repositories/global-variables';
import { getStructuredSettings, upsertStructuredSettings } from '../repositories/structured-settings';

// Explicit, deterministic mapping from known legacy Global Variable keys (created either by
// migration 0024_volatile_spiral.sql's Settings.contactEmail/socialLinks backfill, or by
// GlobalVariablesPage.tsx's own "Site Info" template) to a Structured Settings module + field.
// Anything not listed here — including any social_<platform> key, handled separately below —
// is left completely untouched, never guessed at.
const DIRECT_KEY_MAP: Record<string, { module: StructuredSettingsModule; field: string }> = {
  site_name: { module: 'general', field: 'siteName' },
  tagline: { module: 'general', field: 'tagline' },
  contact_email: { module: 'contact', field: 'email' },
  contact_phone: { module: 'contact', field: 'phone' },
  contact_address: { module: 'contact', field: 'address' },
  footer_copyright: { module: 'footer', field: 'copyrightText' },
};

const SOCIAL_KEY_PREFIX = 'social_';

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

// Runs once (idempotent — safe to call any number of times): only ever writes a module that
// currently has no row at all. A module already populated (whether by this migration on a
// previous run, or by an admin editing it directly) is left alone, never overwritten.
export async function migrateLegacyGlobalVariables(db: Database): Promise<LegacyMigrationReport> {
  const variables = await listGlobalVariables(db);
  const skippedKeys: LegacyMigrationReport['skippedKeys'] = [];

  const generalPatch: Record<string, unknown> = {};
  const contactPatch: Record<string, unknown> = {};
  const footerPatch: Record<string, unknown> = {};
  const socialLinks: SocialLink[] = [];

  for (const variable of variables) {
    const direct = DIRECT_KEY_MAP[variable.key];
    if (direct) {
      if (direct.module === 'general') generalPatch[direct.field] = variable.value;
      else if (direct.module === 'contact') contactPatch[direct.field] = variable.value;
      else if (direct.module === 'footer') footerPatch[direct.field] = variable.value;
      continue;
    }

    if (variable.key.startsWith(SOCIAL_KEY_PREFIX)) {
      const platformKey = variable.key.slice(SOCIAL_KEY_PREFIX.length).toLowerCase();
      const platform = (KNOWN_SOCIAL_PLATFORMS as readonly string[]).includes(platformKey) ? platformKey : 'custom';
      const link = socialLinkSchema.safeParse({
        platform,
        label: titleCase(platformKey),
        url: variable.value,
      });
      if (link.success) {
        socialLinks.push(link.data);
      } else {
        skippedKeys.push({ key: variable.key, reason: `Not a valid URL: ${variable.value}` });
      }
    }
    // Every other key (unknown, not a recognized legacy name) is left untouched entirely —
    // not even reported, since it was never a candidate for migration in the first place.
  }

  const candidates: Partial<Record<StructuredSettingsModule, Record<string, unknown>>> = {};
  if (Object.keys(generalPatch).length > 0) {
    // siteName is required by the schema — a legacy deployment that only ever set `tagline`
    // (no site_name) can't produce a valid general row; skip rather than fail the whole run.
    if (typeof generalPatch['siteName'] === 'string') candidates.general = generalPatch;
    else skippedKeys.push({ key: 'tagline', reason: 'general.siteName (site_name) is required and was not set' });
  }
  if (Object.keys(contactPatch).length > 0) candidates.contact = contactPatch;
  if (Object.keys(footerPatch).length > 0) candidates.footer = footerPatch;
  if (socialLinks.length > 0) candidates.social = { links: socialLinks };

  const migratedModules: StructuredSettingsModule[] = [];
  const skippedModules: StructuredSettingsModule[] = [];

  for (const module of STRUCTURED_SETTINGS_MODULES) {
    const candidate = candidates[module];
    if (!candidate) continue;

    const existing = await getStructuredSettings(db, module);
    if (existing) {
      skippedModules.push(module);
      continue;
    }

    const schema =
      module === 'general' ? generalSettingsDataSchema : module === 'contact' ? contactSettingsDataSchema : module === 'footer' ? footerSettingsDataSchema : socialSettingsDataSchema;
    // Fill in required-but-nullable fields the legacy keys never had, so the candidate always
    // validates against the module's full schema.
    const withDefaults =
      module === 'general'
        ? { tagline: null, logoMediaId: null, ...candidate }
        : module === 'contact'
          ? { email: null, phone: null, address: null, ...candidate }
          : module === 'footer'
            ? { description: null, links: [], ...candidate }
            : candidate;

    const parsed = schema.safeParse(withDefaults);
    if (!parsed.success) {
      skippedKeys.push({ key: `<${module}>`, reason: parsed.error.issues.map((issue) => issue.message).join('; ') });
      continue;
    }

    await upsertStructuredSettings(db, module, parsed.data);
    migratedModules.push(module);
  }

  return { migratedModules, skippedModules, skippedKeys };
}
