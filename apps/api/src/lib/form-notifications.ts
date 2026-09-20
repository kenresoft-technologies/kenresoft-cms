import type { Form } from '@kenresoft-cms/contracts';

import { getEmailSender } from './email';
import type { Bindings } from './env';

// Only the one method this module actually uses — same reasoning/precedent as webhooks.ts's
// own WaitUntilContext: two @cloudflare/workers-types copies coexist in this monorepo, and
// Hono's c.executionCtx is structurally different from the plain global ExecutionContext.
type WaitUntilContext = Pick<ExecutionContext, 'waitUntil'>;

// Only the two fields actually needed here — accepts either the raw DB row shape
// (routes/public/forms.ts's listFormFields result, createdAt/updatedAt as Date) or the
// contracts FormField shape (string dates), rather than forcing a conversion neither caller
// otherwise needs.
type FieldLabelSource = { name: string; label: string };

function isAttachmentValue(value: unknown): value is { filename?: string; size?: number } {
  return typeof value === 'object' && value !== null && 'key' in value && 'contentType' in value;
}

function formatSubmissionAsText(fields: FieldLabelSource[], data: Record<string, unknown>): string {
  const labelByName = new Map(fields.map((field) => [field.name, field.label]));
  const lines: string[] = [];
  for (const [name, value] of Object.entries(data)) {
    const label = labelByName.get(name) ?? name;
    if (isAttachmentValue(value)) {
      lines.push(`${label}: ${value.filename ?? 'attached file'} (view/download it in the admin — see link below)`);
    } else {
      lines.push(`${label}: ${String(value)}`);
    }
  }
  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSubmissionAsHtml(fields: FieldLabelSource[], data: Record<string, unknown>): string {
  const labelByName = new Map(fields.map((field) => [field.name, field.label]));
  const rows = Object.entries(data)
    .map(([name, value]) => {
      const label = escapeHtml(labelByName.get(name) ?? name);
      const rendered = isAttachmentValue(value)
        ? escapeHtml(`${value.filename ?? 'attached file'} (view/download it in the admin)`)
        : escapeHtml(String(value));
      return `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;white-space:nowrap;">${label}</td><td style="padding:4px 0;">${rendered}</td></tr>`;
    })
    .join('');
  return `<table cellspacing="0" cellpadding="0">${rows}</table>`;
}

// Fired from routes/public/forms.ts right after a submission is created — a visitor-facing
// admin-notification email, distinct from the existing password-reset/verification email
// paths. Opt-in per form (form.notificationEmails), never a deployment-wide default: a
// "Job Application" form and a "Contact" form legitimately want different recipients, and a
// form with nothing configured should stay silent rather than guessing an address. Reuses the
// same pluggable getEmailSender() every other email in this codebase already goes through, so
// it's already covered by EMAIL_PROVIDER's noop-by-default/Resend/Cloudflare selection with no
// new configuration surface. Never throws — a subscriber's email address bouncing, or the
// provider itself being down, must never affect the submission that already succeeded and was
// already persisted (same "never let this write path fail the request" stance webhooks.ts
// documents for its own dispatch).
export function sendFormSubmissionNotification(
  env: Bindings,
  ctx: WaitUntilContext,
  form: Pick<Form, 'id' | 'name' | 'notificationEmails'>,
  fields: FieldLabelSource[],
  submission: { id: string; data: Record<string, unknown> },
  options?: { isTest?: boolean },
): void {
  const recipients = form.notificationEmails;
  if (!recipients || recipients.length === 0) return;

  ctx.waitUntil(
    (async () => {
      const adminUrl = env.ADMIN_URL ?? env.CORS_ORIGINS.split(',')[0]?.trim();
      const submissionLink = adminUrl ? `${adminUrl}/forms/${form.id}/submissions` : null;
      // Prefixed rather than a separate template — a test send should look exactly like the
      // real thing it's verifying, just unmistakably marked so nobody treats it as a real
      // inquiry (this is a real, deliverable email, per the "Preview & Test" feature's own
      // "run the real pipeline" design, not a simulated/logged-only one).
      const subject = options?.isTest ? `[Test] New submission: ${form.name}` : `New submission: ${form.name}`;
      const text =
        (options?.isTest ? 'This is a TEST submission sent from the admin "Preview & Test" tool.\n\n' : '') +
        `A new submission was received for "${form.name}".\n\n` +
        formatSubmissionAsText(fields, submission.data) +
        (submissionLink ? `\n\nView it in the admin: ${submissionLink}` : '');
      const html =
        (options?.isTest
          ? '<p style="color:#b45309;"><strong>This is a TEST submission</strong> sent from the admin "Preview &amp; Test" tool.</p>'
          : '') +
        `<p>A new submission was received for <strong>${escapeHtml(form.name)}</strong>.</p>` +
        formatSubmissionAsHtml(fields, submission.data) +
        (submissionLink
          ? `<p style="margin-top:16px;"><a href="${escapeHtml(submissionLink)}">View it in the admin</a></p>`
          : '');

      const sender = getEmailSender(env);
      await Promise.all(
        recipients.map(async (to) => {
          try {
            await sender.send({ to, subject, text, html });
          } catch (error) {
            console.error(`Failed to send form-submission notification to ${to}:`, error);
          }
        }),
      );
    })(),
  );
}
