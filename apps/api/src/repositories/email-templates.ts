import { EMAIL_TEMPLATE_KEYS } from '@kenresoft-cms/contracts';
import type { EmailTemplateKey, UpdateEmailTemplateInput } from '@kenresoft-cms/contracts';
import { emailTemplates, eq } from '@kenresoft-cms/database';
import type { Database, EmailTemplate } from '@kenresoft-cms/database';

import { getEmailTemplateDefault } from '../lib/email-templates/defaults';

// Every known template key (EMAIL_TEMPLATE_KEYS — a closed set, see that file's own comment)
// always has a row after this runs — inserted from its code default (defaults.ts) the first
// time it's needed, never seeded via migration data. Keeping the actual copy in code rather
// than frozen into a migration means an updated default (a future `pnpm run update`) can reach
// a fresh install's very first seed too, not just new deployments created after that update
// shipped — a migration-seeded row would otherwise never change once written.
// `.onConflictDoNothing()` makes two concurrent first-ever requests safe: at most one insert
// per key actually lands, the other is a no-op, never a duplicate-key error surfaced to a
// caller who did nothing wrong.
async function ensureSeeded(db: Database): Promise<void> {
  const existing = await db.query.emailTemplates.findMany({ columns: { key: true } });
  const existingKeys = new Set(existing.map((row) => row.key));
  const missing = EMAIL_TEMPLATE_KEYS.filter((key) => !existingKeys.has(key));
  if (missing.length === 0) return;

  await db
    .insert(emailTemplates)
    .values(
      missing.map((key) => {
        const def = getEmailTemplateDefault(key);
        return {
          key,
          name: def.name,
          description: def.description,
          subject: def.subject,
          mode: 'standard' as const,
          heading: def.content.heading,
          bodyText: def.content.bodyText,
          ctaLabel: def.content.ctaLabel,
          fineprint: def.content.fineprint,
          bodyHtml: def.bodyHtml,
        };
      }),
    )
    .onConflictDoNothing();
}

// A row created before migration 0055 (mode/heading/bodyText/ctaLabel/fineprint didn't exist
// yet) has `mode === null` — classified here, once, the first time an admin route touches it
// (never on the hot send path; see getEmailTemplateByKeyReadOnly's own comment for why that
// matters). If its bodyHtml still matches what the OLD (pre-refactor) shipped default rendered
// — reproduced bit-for-bit by defaults.ts's own buildDefaultBodyHtml, since it composes the same
// content through the same Modern Minimal design the original hand-written shell always used —
// it was never actually customized, so it becomes 'standard' with that same content backfilled.
// Otherwise an admin really did write their own HTML at some point, and it becomes 'developer',
// with its bodyHtml preserved exactly as-is — never discarded or reinterpreted as structured
// content it was never authored as.
async function resolveLegacyMode(db: Database, row: EmailTemplate): Promise<EmailTemplate> {
  if (row.mode !== null) return row;

  const def = getEmailTemplateDefault(row.key);
  const wasCustomized = row.subject !== def.subject || row.bodyHtml !== def.bodyHtml || row.plainText !== null;

  const [updated] = await db
    .update(emailTemplates)
    .set(
      wasCustomized
        ? { mode: 'developer', heading: def.content.heading, bodyText: def.content.bodyText, ctaLabel: def.content.ctaLabel, fineprint: def.content.fineprint }
        : {
            mode: 'standard',
            heading: def.content.heading,
            bodyText: def.content.bodyText,
            ctaLabel: def.content.ctaLabel,
            fineprint: def.content.fineprint,
          },
    )
    .where(eq(emailTemplates.id, row.id))
    .returning();
  return updated ?? row;
}

export async function listEmailTemplates(db: Database): Promise<EmailTemplate[]> {
  await ensureSeeded(db);
  const rows = await db.query.emailTemplates.findMany();
  return Promise.all(rows.map((row) => resolveLegacyMode(db, row)));
}

export async function getEmailTemplateByKey(db: Database, key: EmailTemplateKey): Promise<EmailTemplate | undefined> {
  await ensureSeeded(db);
  const row = await db.query.emailTemplates.findFirst({ where: eq(emailTemplates.key, key) });
  return row ? resolveLegacyMode(db, row) : undefined;
}

// A plain, seed-free read — used only by the actual send path (lib/email-templates/send.ts),
// never by the admin routes. Deliberately never writes: a real transactional send (a user
// waiting on a verification/reset email right now) must never be the thing that first creates
// this table's rows, since that write is exactly what was found to race the response in this
// codebase's own test suite — @cloudflare/vitest-pool-workers' "flush every ctx.waitUntil()
// before SELF.fetch() resolves" guarantee, confirmed to hold for a top-level route's own
// waitUntil call (webhooks-routes.test.ts), did not reliably extend to a write nested three
// closures deep inside better-auth's own backgroundTasks abstraction — reproduced by bisecting
// this exact function out of the call chain. A missing row here behaves identically to a
// disabled/failed-to-load one: sendTemplatedEmail renders the code default, which is exactly
// what a freshly-seeded row's own content would have been anyway — the seed becomes real the
// first time any admin route touches this feature (getEmailTemplateByKey/listEmailTemplates
// above), which will always be before anyone could have customized it.
export function getEmailTemplateByKeyReadOnly(db: Database, key: EmailTemplateKey): Promise<EmailTemplate | undefined> {
  return db.query.emailTemplates.findFirst({ where: eq(emailTemplates.key, key) });
}

// `patch.content` (a nested { heading, bodyText, ctaLabel, fineprint } object, matching the API
// shape) is flattened to this table's own flat columns — the DB has no nested-object column for
// it. Everything else in `patch` already matches a column name 1:1.
export async function updateEmailTemplate(
  db: Database,
  key: EmailTemplateKey,
  patch: UpdateEmailTemplateInput,
): Promise<EmailTemplate | undefined> {
  await ensureSeeded(db);
  const { content, ...rest } = patch;
  const [row] = await db
    .update(emailTemplates)
    .set({
      ...rest,
      ...(content
        ? { heading: content.heading, bodyText: content.bodyText, ctaLabel: content.ctaLabel, fineprint: content.fineprint }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(emailTemplates.key, key))
    .returning();
  return row;
}

// Resets subject/mode/content/bodyHtml/plainText back to the shipped default (always Standard
// mode, since that's what every default ships as), but leaves `enabled` alone — restoring copy
// is not the same action as re-enabling a template someone deliberately turned off, and silently
// flipping enabled back on would be a real, unexpected behavior change.
export async function restoreEmailTemplateDefault(db: Database, key: EmailTemplateKey): Promise<EmailTemplate | undefined> {
  await ensureSeeded(db);
  const def = getEmailTemplateDefault(key);
  const [row] = await db
    .update(emailTemplates)
    .set({
      subject: def.subject,
      mode: 'standard',
      heading: def.content.heading,
      bodyText: def.content.bodyText,
      ctaLabel: def.content.ctaLabel,
      fineprint: def.content.fineprint,
      bodyHtml: def.bodyHtml,
      plainText: null,
      updatedAt: new Date(),
    })
    .where(eq(emailTemplates.key, key))
    .returning();
  return row;
}
