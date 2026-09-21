import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractLinks, noopEmailSender } from '../src/lib/email/noop';

describe('noop email sender', () => {
  afterEach(() => vi.restoreAllMocks());

  it('extracts unique http(s) links and nothing else', () => {
    const text = 'Verify: https://cms.example.com/verify-email?token=abc.def and again https://cms.example.com/verify-email?token=abc.def\nTemporary password: hunter2';
    expect(extractLinks(text)).toEqual(['https://cms.example.com/verify-email?token=abc.def']);
    expect(extractLinks('no links here')).toEqual([]);
  });

  it('logs the recipient, subject and links, but never the body text', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await noopEmailSender.send({
      to: 'owner@example.com',
      subject: 'Verify your email',
      text: 'Click https://cms.example.com/verify-email?token=t1 — your temporary password is hunter2',
    });
    expect(log).toHaveBeenCalledTimes(1);
    const payload = log.mock.calls[0]![1] as { to: string; subject: string; links: string[] };
    expect(payload).toEqual({ to: 'owner@example.com', subject: 'Verify your email', links: ['https://cms.example.com/verify-email?token=t1'] });
    expect(JSON.stringify(log.mock.calls)).not.toContain('hunter2');
  });
});
