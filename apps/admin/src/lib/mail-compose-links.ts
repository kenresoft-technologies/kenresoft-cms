import type { MailClient } from '@/lib/types';

interface ComposeParams {
  to: string;
  subject: string;
  body?: string;
}

// Every one of these opens that provider's own webmail compose screen pre-filled, so "Reply by
// email" can open the actual app a person uses day to day instead of whatever the OS/browser
// happens to have registered as the default mailto: handler (which the CMS has no way to know
// or influence). null means "no known deep link" — the caller falls back to a plain mailto:,
// which every browser/OS already knows how to route to *some* mail app.
const COMPOSE_URL_BUILDERS: Record<MailClient, (params: ComposeParams) => string> = {
  gmail: ({ to, subject, body }) =>
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}` +
    (body ? `&body=${encodeURIComponent(body)}` : ''),
  outlook: ({ to, subject, body }) =>
    `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}` +
    (body ? `&body=${encodeURIComponent(body)}` : ''),
  yahoo: ({ to, subject, body }) =>
    `https://compose.mail.yahoo.com/?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}` +
    (body ? `&body=${encodeURIComponent(body)}` : ''),
  zoho: ({ to, subject, body }) =>
    `https://mail.zoho.com/zm/#compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}` +
    (body ? `&body=${encodeURIComponent(body)}` : ''),
};

function buildMailtoLink({ to, subject, body }: ComposeParams): string {
  const params = new URLSearchParams({ subject });
  if (body) params.set('body', body);
  return `mailto:${to}?${params.toString()}`;
}

// preferredMailClient is a plain, unvalidated string on the server (auth-options.ts) — an
// unrecognized or unset value (including the pre-migration `null` every existing account has)
// falls back to mailto rather than erroring, since this is a cosmetic convenience, never a
// required capability.
export function buildReplyLink(preferredMailClient: string | null | undefined, params: ComposeParams): string {
  const builder = preferredMailClient ? COMPOSE_URL_BUILDERS[preferredMailClient as MailClient] : undefined;
  return builder ? builder(params) : buildMailtoLink(params);
}

// Whether buildReplyLink's result should open in a new tab (every webmail deep link) vs. the
// current one (mailto:, which the browser hands off to a native app without ever navigating
// away).
export function opensInNewTab(preferredMailClient: string | null | undefined): boolean {
  return Boolean(preferredMailClient && preferredMailClient in COMPOSE_URL_BUILDERS);
}
