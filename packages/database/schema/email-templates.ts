import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import type { EmailTemplateKey, EmailTemplateMode } from '@kenresoft-cms/contracts';

export type { EmailTemplateKey, EmailTemplateMode };

// One row per known transactional email (`key` is a closed set — EMAIL_TEMPLATE_KEYS in
// packages/contracts/schemas/enums.ts — never a free-form admin-created template; see that
// file's own comment for why arbitrary custom templates are out of scope). Every key is
// seeded once by migration 0054 with Kenresoft's own default copy/design, so a fresh
// deployment always has a real, ready-to-send template for verification/password-reset from
// day one — never a missing row a first send would have to handle as a special case.
// `plainText` is nullable: null means "derive it from bodyHtml on every send"
// (apps/api/src/lib/html-to-text.ts), the default for every seeded template; an admin who
// wants a hand-written plain-text version can set one explicitly. Whether a row still matches
// its shipped default (for a "Customized" badge) is computed by comparing against
// apps/api/src/lib/email-templates/defaults.ts at read time, not stored — a stored flag could
// drift from the truth if the code default itself is later changed by an update.
export const emailTemplates = sqliteTable('email_templates', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  key: text('key').notNull().unique().$type<EmailTemplateKey>(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  subject: text('subject').notNull(),
  // 'standard'|'developer'|NULL — NULL means "this row predates the Standard/Developer split"
  // (every row created before migration 0056) and is classified lazily on first read
  // (apps/api/src/repositories/email-templates.ts's resolveLegacyMode): a row whose bodyHtml
  // still matches the OLD shipped default becomes 'standard' (with heading/bodyText/ctaLabel/
  // fineprint backfilled from that same default's structured content); a row an admin had
  // actually customized becomes 'developer', preserving exactly what they wrote — never
  // silently discarded or reinterpreted. New rows are always seeded with 'standard' set
  // directly, so NULL is a purely historical state, not one new installs ever produce.
  // (migration 0055 adds this column and its four content siblings below)
  mode: text('mode').$type<EmailTemplateMode>(),
  // Standard mode's structured content — nullable because a Developer-mode-only row (or an
  // unclassified legacy row) may never have had these computed. Once backfilled (seed or lazy
  // classification) they're always populated, even while mode is currently 'developer', so
  // switching back to Standard has real content to start from.
  heading: text('heading'),
  bodyText: text('body_text'),
  ctaLabel: text('cta_label'),
  fineprint: text('fineprint'),
  bodyHtml: text('body_html').notNull(),
  plainText: text('plain_text'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;
