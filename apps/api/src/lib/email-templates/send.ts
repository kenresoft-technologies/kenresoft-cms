import type { EmailTemplateKey } from '@kenresoft-cms/contracts';
import type { Database } from '@kenresoft-cms/database';

import { getEmailSender } from '../email';
import type { Bindings } from '../env';
import { buildCommonTemplateContext } from './context';
import { getEmailTemplateDefault } from './defaults';
import { getEmailTemplateByKeyReadOnly } from '../../repositories/email-templates';
import { renderEmailTemplate } from './render';
import type { TemplateVariables } from './render';

// The one path every real (non-preview, non-test) transactional send goes through — used by
// apps/api/src/lib/auth.ts (both verification branches) and
// apps/api/src/routes/public/password-reset.ts. Loads the admin-configured template, merges
// the deployment's real site/design context with this specific send's own variables
// (user.name, verificationUrl, ...), and sends through the already-configured email provider.
//
// Never lets a misconfigured template take down authentication: if the template is missing,
// disabled, or fails to render for any reason, this falls back to the code default's own
// content instead of throwing — a broken save in the admin editor must never mean nobody can
// verify their email or reset their password. The failure is still logged (visible via
// `wrangler tail`) so it's not silently invisible either.
export async function sendTemplatedEmail(
  db: Database,
  env: Bindings,
  key: EmailTemplateKey,
  to: string,
  ownVariables: TemplateVariables,
): Promise<void> {
  const def = getEmailTemplateDefault(key);
  let subject = def.subject;
  let bodyHtml = def.bodyHtml;
  let plainText: string | null = null;

  try {
    // Read-only, deliberately never seeds/writes — see getEmailTemplateByKeyReadOnly's own
    // comment for why this matters specifically on this path.
    const template = await getEmailTemplateByKeyReadOnly(db, key);
    if (template && template.enabled) {
      subject = template.subject;
      bodyHtml = template.bodyHtml;
      plainText = template.plainText;
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
    const rendered = renderEmailTemplate({ subject, bodyHtml, plainText }, variables);
    await getEmailSender(env).send({ to, subject: rendered.subject, html: rendered.html, text: rendered.text });
  } catch (error) {
    console.error(`Failed to render email template "${key}"; falling back to a minimal plain-text send.`, error);
    // A last-resort, template-system-free send — no design tokens, no stored copy, just enough
    // for the recipient to actually complete the flow they're waiting on. ownVariables always
    // carries the one link (verificationUrl/resetUrl) this minimal message needs.
    const link = ownVariables.verificationUrl ?? ownVariables.resetUrl ?? '';
    await getEmailSender(env).send({
      to,
      subject: def.subject,
      text: `${def.name}\n\n${link}\n\nThis link will expire soon. If you didn't expect this, you can ignore this email.`,
    });
  }
}
