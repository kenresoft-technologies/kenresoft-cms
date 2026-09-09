import { z } from 'zod';

import { SOCIAL_PLATFORMS, STRUCTURED_SETTINGS_MODULES } from './enums';

export const structuredSettingsModuleSchema = z.enum(STRUCTURED_SETTINGS_MODULES);

// --- general: public site branding, distinct from the CMS-internal Settings.name (deployment
// identity shown in the admin sidebar/tab) — a deployment's own admin label and the public
// site's displayed name are allowed to differ. logoMediaId references an existing Media row
// (packages/database/schema/media.ts) rather than duplicating filename/URL/dimensions here.
export const generalSettingsDataSchema = z.object({
  siteName: z.string().min(1).max(200),
  tagline: z.string().max(300).nullable(),
  logoMediaId: z.string().nullable(),
});

// --- contact
export const contactSettingsDataSchema = z.object({
  email: z.union([z.null(), z.string().email().max(320)]),
  phone: z.string().max(50).nullable(),
  address: z.string().max(500).nullable(),
});

// --- social: a links collection, not one column per platform, so a new platform never needs a
// migration (docs/PLUGINS.md-style extensibility, but for a Core module rather than a plugin).
export const socialLinkSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  label: z.string().min(1).max(100),
  url: z.string().url().max(500),
});

export const socialSettingsDataSchema = z.object({
  links: z.array(socialLinkSchema).max(50),
});

// --- navigation: intentionally simple — one flat, orderable list, no nested menus.
export const navigationItemSchema = z.object({
  label: z.string().min(1).max(100),
  url: z.string().min(1).max(500),
  visible: z.boolean(),
  order: z.number().int(),
  external: z.boolean(),
  newTab: z.boolean(),
});

export const navigationSettingsDataSchema = z.object({
  items: z.array(navigationItemSchema).max(100),
});

// --- footer
export const footerLinkSchema = z.object({
  label: z.string().min(1).max(100),
  url: z.string().min(1).max(500),
});

export const footerSettingsDataSchema = z.object({
  description: z.string().max(1000).nullable(),
  copyrightText: z.string().max(300).nullable(),
  links: z.array(footerLinkSchema).max(50),
});

// --- seo: site-default only — page-specific SEO belongs on the relevant content type/entry,
// never here.
export const seoSettingsDataSchema = z.object({
  defaultTitle: z.string().max(200).nullable(),
  defaultDescription: z.string().max(500).nullable(),
  defaultOgImageMediaId: z.string().nullable(),
  googleSiteVerification: z.string().max(300).nullable(),
});

export const structuredSettingsDataSchemaByModule = {
  general: generalSettingsDataSchema,
  contact: contactSettingsDataSchema,
  social: socialSettingsDataSchema,
  navigation: navigationSettingsDataSchema,
  footer: footerSettingsDataSchema,
  seo: seoSettingsDataSchema,
} as const;

export type GeneralSettingsData = z.infer<typeof generalSettingsDataSchema>;
export type ContactSettingsData = z.infer<typeof contactSettingsDataSchema>;
export type SocialLink = z.infer<typeof socialLinkSchema>;
export type SocialSettingsData = z.infer<typeof socialSettingsDataSchema>;
export type NavigationItem = z.infer<typeof navigationItemSchema>;
export type NavigationSettingsData = z.infer<typeof navigationSettingsDataSchema>;
export type FooterLink = z.infer<typeof footerLinkSchema>;
export type FooterSettingsData = z.infer<typeof footerSettingsDataSchema>;
export type SeoSettingsData = z.infer<typeof seoSettingsDataSchema>;

export type StructuredSettingsDataByModule = {
  general: GeneralSettingsData;
  contact: ContactSettingsData;
  social: SocialSettingsData;
  navigation: NavigationSettingsData;
  footer: FooterSettingsData;
  seo: SeoSettingsData;
};

// The stored/returned row shape for one module — `data` is validated against the module's own
// schema at the route layer (see apps/api/src/routes/admin/structured-settings.ts), so this
// generic envelope just carries an already-valid JSON value here.
export const structuredSettingsRowSchema = z.object({
  id: z.string(),
  module: structuredSettingsModuleSchema,
  data: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StructuredSettingsRow = z.infer<typeof structuredSettingsRowSchema>;

export const legacyMigrationReportSchema = z.object({
  migratedModules: z.array(structuredSettingsModuleSchema),
  skippedModules: z.array(structuredSettingsModuleSchema),
  skippedKeys: z.array(z.object({ key: z.string(), reason: z.string() })),
});

export type LegacyMigrationReport = z.infer<typeof legacyMigrationReportSchema>;
