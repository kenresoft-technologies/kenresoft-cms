import type { Bindings } from '../env';
import type { EmailMessage, EmailSender } from './types';

// Encodes in 3-byte-aligned slices so no giant intermediate binary string is ever built (the
// message is buffered in Worker memory), and slices concatenate into valid base64.
export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const slice = 3 * 0x2000;
  for (let i = 0; i < bytes.length; i += slice) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(i, i + slice))));
  }
  return parts.join('');
}

// Resend's REST API directly — no SDK dependency needed for a single POST. Requires
// RESEND_API_KEY (a Worker secret, `wrangler secret put RESEND_API_KEY`) and EMAIL_FROM (must
// be a verified sending domain in the Resend dashboard).
export function createResendEmailSender(env: Bindings): EmailSender {
  return {
    async send(message: EmailMessage) {
      if (!env.RESEND_API_KEY) {
        throw new Error('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set');
      }
      if (!env.EMAIL_FROM) {
        throw new Error('EMAIL_PROVIDER=resend but EMAIL_FROM is not set');
      }

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: message.from ?? env.EMAIL_FROM,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(message.replyTo !== undefined ? { reply_to: message.replyTo } : {}),
          ...(message.attachments?.length
            ? {
                attachments: message.attachments.map((a) => ({
                  filename: a.filename,
                  content: toBase64(a.content),
                  content_type: a.contentType,
                })),
              }
            : {}),
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Resend API request failed (${response.status}): ${body}`);
      }
    },
  };
}
