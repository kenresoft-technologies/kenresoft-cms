import { z } from 'zod';

import { EMAIL_DESIGN_IDS, SOCIAL_PLATFORMS, STRUCTURED_SETTINGS_MODULES } from './enums';
import { safeUrlSchema } from './safe-url';

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
  url: safeUrlSchema(500),
});

export const socialSettingsDataSchema = z.object({
  links: z.array(socialLinkSchema).max(50),
});

// --- navigation: intentionally simple — one flat, orderable list, no nested menus.
// A target is either a literal `url` or a `pageId` reference to a Page (docs/SITE_BUILDER.md
// §3.7) — resolved to that Page's own `route` at render time by the Astro SDK. Existing
// `url`-only rows keep validating unmodified; `pageId` is purely additive.
const navigationItemBaseSchema = z.object({
  label: z.string().min(1).max(100),
  visible: z.boolean(),
  order: z.number().int(),
  external: z.boolean(),
  newTab: z.boolean(),
});

export const navigationItemSchema = z.union([
  navigationItemBaseSchema.extend({ url: safeUrlSchema(500) }),
  navigationItemBaseSchema.extend({ pageId: z.string().min(1) }),
]);

export const navigationSettingsDataSchema = z.object({
  items: z.array(navigationItemSchema).max(100),
});

// --- footer
export const footerLinkSchema = z.object({
  label: z.string().min(1).max(100),
  url: safeUrlSchema(500),
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

// --- emailBranding: design tokens shared by every transactional email template
// (apps/api/src/lib/email-templates/render.ts merges these into every render as `design.*`
// variables) — one place to change the look of every email at once, rather than editing each
// template's own HTML. A color is a hex string (`#rrggbb`); every field is optional/nullable so
// an unconfigured deployment renders with the built-in Kenresoft-style defaults
// (apps/api/src/lib/email-templates/defaults.ts) rather than needing setup before any
// transactional email can send. logoMediaId references an existing Media row, same convention
// as `general.logoMediaId` — deliberately a separate field, since a square admin-sidebar logo
// and a wide email-header logo are often not the same asset.
const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #4f46e5')
  .nullable();

export const emailBrandingSettingsDataSchema = z.object({
  brandColor: hexColorSchema,
  pageBackground: hexColorSchema,
  contentBackground: hexColorSchema,
  textColor: hexColorSchema,
  mutedTextColor: hexColorSchema,
  buttonTextColor: hexColorSchema,
  logoMediaId: z.string().nullable(),
  footerText: z.string().max(500).nullable(),
  // The one active built-in design every system email (verification, password reset, ...)
  // renders through — null means the shipped default ('modern-minimal'). Deliberately global,
  // not per-template-key: switching designs is a single deployment-wide choice
  // (apps/api/src/lib/email-templates/designs.ts holds the registry), so every system email
  // keeps looking like it came from the same system rather than admins picking a different look
  // per email type.
  // .nullable().optional() rather than just .nullable(): an admin PUT built against the old
  // shape (before this field existed) sends no key for it at all, which .nullable() alone would
  // reject as a missing required property.
  designId: z.enum(EMAIL_DESIGN_IDS).nullable().optional(),
  // Whether the admin UI's Developer Customization option (raw-HTML per-template editing) is
  // shown at all — null/false means Standard mode only. Doesn't retroactively touch a template
  // already sitting in Developer mode from before this was turned off; it only hides the control
  // that would let someone newly switch a template *into* Developer mode.
  developerModeEnabled: z.boolean().nullable().optional(),
});

export type EmailBrandingSettingsData = z.infer<typeof emailBrandingSettingsDataSchema>;

export const structuredSettingsDataSchemaByModule = {
  general: generalSettingsDataSchema,
  contact: contactSettingsDataSchema,
  social: socialSettingsDataSchema,
  navigation: navigationSettingsDataSchema,
  footer: footerSettingsDataSchema,
  seo: seoSettingsDataSchema,
  emailBranding: emailBrandingSettingsDataSchema,
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
  emailBranding: EmailBrandingSettingsData;
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
