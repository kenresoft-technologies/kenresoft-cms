import { describe, expect, it } from 'vitest';

import { buildReplyLink, opensInNewTab } from '@/lib/mail-compose-links';

describe('buildReplyLink', () => {
  it('falls back to mailto for null/undefined/unrecognized preferences', () => {
    for (const pref of [null, undefined, '', 'not-a-real-client']) {
      expect(buildReplyLink(pref, { to: 'jane@example.com', subject: 'Hi' })).toBe(
        'mailto:jane@example.com?subject=Hi',
      );
    }
  });

  it('builds a Gmail compose deep link', () => {
    const link = buildReplyLink('gmail', { to: 'jane@example.com', subject: 'Re: Contact' });
    expect(link).toBe(
      'https://mail.google.com/mail/?view=cm&fs=1&to=jane%40example.com&su=Re%3A%20Contact',
    );
  });

  it('builds an Outlook compose deep link', () => {
    const link = buildReplyLink('outlook', { to: 'jane@example.com', subject: 'Re: Contact' });
    expect(link).toBe(
      'https://outlook.live.com/mail/0/deeplink/compose?to=jane%40example.com&subject=Re%3A%20Contact',
    );
  });

  it('builds a Yahoo compose deep link', () => {
    const link = buildReplyLink('yahoo', { to: 'jane@example.com', subject: 'Re: Contact' });
    expect(link).toBe('https://compose.mail.yahoo.com/?to=jane%40example.com&subject=Re%3A%20Contact');
  });

  it('builds a Zoho compose deep link', () => {
    const link = buildReplyLink('zoho', { to: 'jane@example.com', subject: 'Re: Contact' });
    expect(link).toBe('https://mail.zoho.com/zm/#compose?to=jane%40example.com&subject=Re%3A%20Contact');
  });

  it('includes an optional body param', () => {
    const link = buildReplyLink('gmail', { to: 'jane@example.com', subject: 'Hi', body: 'Thanks a lot' });
    expect(link).toContain('&body=Thanks%20a%20lot');
  });
});

describe('opensInNewTab', () => {
  it('is true only for a recognized webmail client', () => {
    expect(opensInNewTab('gmail')).toBe(true);
    expect(opensInNewTab('outlook')).toBe(true);
    expect(opensInNewTab('yahoo')).toBe(true);
    expect(opensInNewTab('zoho')).toBe(true);
    expect(opensInNewTab(null)).toBe(false);
    expect(opensInNewTab(undefined)).toBe(false);
    expect(opensInNewTab('')).toBe(false);
    expect(opensInNewTab('not-a-real-client')).toBe(false);
  });
});
