import type { EmailTemplateKey } from '@kenresoft-cms/contracts';
import type { Database } from '@kenresoft-cms/database';

import { getEmailSender } from '../email';
import type { EmailMessage } from '../email';
import type { Bindings } from '../env';
import { buildCommonTemplateContext } from './context';
import { getEmailTemplateDefault } from './defaults';
import { getEmailTemplateByKeyReadOnly } from '../../repositories/email-templates';
import { renderEmailTemplate } from './render';
import type { TemplateVariables } from './render';
import { renderStandardModeBodyHtml } from './standard-render';

export interface PreparedTemplatedEmail {
  subject: string;
  html: string;
  text: string;
}

// The DB-lookup-and-render half of a templated send — deliberately awaited inline by every
// caller (never itself backgrounded), so the only genuinely variable-latency step left to
// background is the actual outbound call to the email provider. This split matters for
// apps/api/src/routes/public/password-reset.ts specifically: its own comment documents that
// backgrounding the send is a deliberate enumeration-safety measure (an external provider's
// network latency must never leak whether an email address exists), a property that only needs
// the provider call itself to be backgrounded — this deployment's own D1 reads are already the
// same regardless of which branch the route took. Splitting it out this way also closes a real
// bug this same codebase's test suite caught: a write nested three closures deep inside better-
// auth's own backgroundTasks/waitUntil abstraction was found (docs/ARCHITECTURE.md's changelog)
// to race @cloudflare/vitest-pool-workers' "flush every ctx.waitUntil() before SELF.fetch()
// resolves" guarantee — reproduced again here for a *read-only* chain nested only one level via
// a plain top-level `c.executionCtx.waitUntil(...)` call, meaning the guarantee's reliability
// degrades with how much awaited work sits between registering the task and the response
// finishing, not just with nesting depth or writes specifically. Awaiting this half inline
// removes that dependency on timing entirely, in both the test pool and real Workers.
//
// Never lets a misconfigured template take down authentication: if the template is missing,
// disabled, or fails to render for any reason, this falls back to the code default's own
// content instead of throwing — a broken save in the admin editor must never mean nobody can
// verify their email or reset their password. The failure is still logged (visible via
// `wrangler tail`) so it's not silently invisible either.
export async function prepareTemplatedEmail(
  db: Database,
  env: Bindings,
  key: EmailTemplateKey,
  ownVariables: TemplateVariables,
): Promise<PreparedTemplatedEmail> {
  const def = getEmailTemplateDefault(key);
  let subject = def.subject;
  let bodyHtml = def.bodyHtml;
  let plainText: string | null = null;

  try {
    // Read-only, deliberately never seeds/writes — see getEmailTemplateByKeyReadOnly's own
    // comment for why that matters specifically on this path.
    const template = await getEmailTemplateByKeyReadOnly(db, key);
    if (template && template.enabled) {
      subject = template.subject;
      plainText = template.plainText;
      // 'standard' renders live from the structured content columns (current branding/design
      // included, never stale); 'developer' — and a legacy row whose `mode` is still null,
      // never resolved because this read-only path deliberately never writes — uses the stored
      // bodyHtml directly, exactly as every template worked before this mode split existed.
      bodyHtml =
        template.mode === 'standard' && template.heading && template.bodyText && template.ctaLabel && template.fineprint
          ? await renderStandardModeBodyHtml(db, env, key, {
              heading: template.heading,
              bodyText: template.bodyText,
              ctaLabel: template.ctaLabel,
              fineprint: template.fineprint,
            })
          : template.bodyHtml;
    } else if (template && !template.enabled) {
      // An admin explicitly disabled this template — a strange thing to do for a security-
      // critical email, but the safe minimal fallback below still sends something rather than
      // silently dropping a verification/reset email a user is waiting on.
      console.warn(`Email template "${key}" is disabled; sending the built-in default instead.`);
    }
  } catch (error) {
    console.error(`Failed to load email template "${key}"; sending the built-in default instead.`, error);
  }

  try {
    const variables = { ...(await buildCommonTemplateContext(db, env)), ...ownVariables };
    return renderEmailTemplate({ subject, bodyHtml, plainText }, variables);
  } catch (error) {
    console.error(`Failed to render email template "${key}"; falling back to a minimal plain-text send.`, error);
    // A last-resort, template-system-free message — no design tokens, no stored copy, just
    // enough for the recipient to actually complete the flow they're waiting on. ownVariables
    // always carries the one link (verificationUrl/resetUrl) this minimal message needs.
    const link = ownVariables.verificationUrl ?? ownVariables.resetUrl ?? '';
    return {
      subject: def.subject,
      html: '',
      text: `${def.name}\n\n${link}\n\nThis link will expire soon. If you didn't expect this, you can ignore this email.`,
    };
  }
}

// Prepares (awaited) and sends (not awaited by the caller unless it chooses to) a templated
// email in one call — the convenience wrapper for auth.ts's two verification branches, which
// already run inside better-auth's own backgroundTasks abstraction and have no separate "await
// this part, background that part" boundary to split across. Routes with their own explicit
// `c.executionCtx.waitUntil(...)` call (password-reset.ts) use `prepareTemplatedEmail` directly
// instead, so only the actual `sender.send()` call ends up inside that `waitUntil`.
export async function sendTemplatedEmail(
  db: Database,
  env: Bindings,
  key: EmailTemplateKey,
  to: string,
  ownVariables: TemplateVariables,
): Promise<void> {
  const rendered = await prepareTemplatedEmail(db, env, key, ownVariables);
  await sendPreparedEmail(env, to, rendered);
}

export function sendPreparedEmail(env: Bindings, to: string, rendered: PreparedTemplatedEmail): Promise<void> {
  const message: EmailMessage = rendered.html
    ? { to, subject: rendered.subject, html: rendered.html, text: rendered.text }
    : { to, subject: rendered.subject, text: rendered.text };
  return getEmailSender(env).send(message);
}
