import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, patchMock, postMock, putMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, patch: patchMock, post: postMock, put: putMock } };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EmailTemplatesPage } from '@/pages/EmailTemplatesPage';

const templates = [
  {
    id: 't-1',
    key: 'email_verification',
    name: 'Email verification (website account)',
    description: 'Sent when someone signs up on your public site.',
    subject: 'Verify your email address',
    mode: 'standard',
    content: {
      heading: 'Verify your email address',
      bodyText: "You're almost there. Verify your email address to finish setting up your account.",
      ctaLabel: 'Verify email',
      fineprint: 'This link expires in {{expiresIn}}.',
    },
    bodyHtml: '<p>Verify {{verificationUrl}}</p>',
    plainText: null,
    enabled: true,
    isCustomized: false,
    availableVariables: ['user.name', 'verificationUrl', 'design.brandColor'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 't-2',
    key: 'password_reset',
    name: 'Password reset',
    description: 'Sent when a password reset is requested.',
    subject: 'Reset your password',
    mode: 'developer',
    content: {
      heading: 'Reset your password',
      bodyText: 'Someone requested a password reset for your account.',
      ctaLabel: 'Reset password',
      fineprint: 'This link expires in {{expiresIn}}.',
    },
    bodyHtml: '<p>Reset {{resetUrl}}</p>',
    plainText: null,
    enabled: false,
    isCustomized: true,
    availableVariables: ['user.name', 'resetUrl'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const designs = [
  { id: 'modern-minimal', name: 'Modern Minimal', description: 'A clean, spacious layout.' },
  { id: 'cloudflare-inspired', name: 'Cloudflare-Inspired', description: 'A bold header band.' },
  { id: 'corporate', name: 'Corporate', description: 'A traditional layout.' },
  { id: 'elegant', name: 'Elegant', description: 'Refined and airy.' },
  { id: 'simple', name: 'Simple', description: 'Very lightweight.' },
];

function mockGet(developerModeEnabled = false) {
  getMock.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/email-templates') return Promise.resolve(templates);
    if (path === '/api/v1/admin/email-templates/designs') return Promise.resolve(designs);
    if (path === '/api/v1/admin/structured-settings/emailBranding') {
      return Promise.resolve({
        id: 'b-1',
        module: 'emailBranding',
        data: { designId: 'modern-minimal', developerModeEnabled, logoMediaId: null, footerText: null, brandColor: '#6366f1' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    }
    return Promise.resolve(null);
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EmailTemplatesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EmailTemplatesPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
    postMock.mockReset();
    putMock.mockReset();
    postMock.mockResolvedValue({ subject: 'x', html: '<p>x</p>', text: 'x' });
    mockGet();
  });

  it('lists the built-in designs, marking the active one, with a real rendered preview per card', async () => {
    renderPage();
    // The "Preview email as" select's own current-value text also reads "Email verification
    // (website account)" (the default previewed type), so this waits on a design name instead —
    // unambiguous, since no email type happens to share a name with a design.
    await waitFor(() => expect(screen.getAllByText('Modern Minimal').length).toBeGreaterThan(0));
    expect(screen.getByText('Cloudflare-Inspired')).toBeInTheDocument();
    expect(screen.getByText('Corporate')).toBeInTheDocument();
    expect(screen.getByText('Elegant')).toBeInTheDocument();
    expect(screen.getByText('Simple')).toBeInTheDocument();
    expect(screen.getAllByText('Active')).toHaveLength(1);
    // Every design card rendered a real preview iframe (fetched via apiClient.post), not a
    // static swatch.
    await waitFor(() => expect(screen.getAllByTitle('Email preview').length).toBeGreaterThanOrEqual(5));
  });

  it('lists every template with its customized/default and enabled/disabled state', async () => {
    renderPage();

    // "Email verification (website account)" also appears as the "Preview email as" select's
    // current value (it's the default previewed type) — assert on the count instead.
    await waitFor(() => expect(screen.getAllByText('Email verification (website account)').length).toBeGreaterThan(0));
    expect(screen.getByText('Password reset')).toBeInTheDocument();
    expect(screen.getAllByText('Default')).toHaveLength(1);
    expect(screen.getAllByText('Customized')).toHaveLength(1);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Developer HTML')).toBeInTheDocument();
  });

  it('opens the first (Standard-mode) template in the editor by default, showing plain content fields and no raw HTML/variables', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));
    expect(screen.getByLabelText('Heading')).toHaveValue('Verify your email address');
    expect(screen.getByLabelText('Message')).toHaveValue(templates[0]!.content.bodyText);
    expect(screen.getByLabelText('Button label')).toHaveValue('Verify email');
    expect(screen.queryByLabelText('Body HTML')).not.toBeInTheDocument();
    expect(screen.queryByText('{{verificationUrl}}')).not.toBeInTheDocument();
  });

  it("a template already in Developer mode still shows its raw HTML editor even when Developer Customization is off deployment-wide", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));

    await userEvent.click(screen.getByText('Password reset'));

    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Reset your password'));
    expect(screen.getByLabelText('Body HTML')).toHaveValue('<p>Reset {{resetUrl}}</p>');
    expect(screen.getByText('{{resetUrl}}')).toBeInTheDocument();
  });

  it('saves structured content changes for a Standard-mode template', async () => {
    patchMock.mockResolvedValue({ ...templates[0], subject: 'New subject' });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));

    await userEvent.clear(screen.getByLabelText('Subject'));
    await userEvent.type(screen.getByLabelText('Subject'), 'New subject');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/email-templates/email_verification', {
        mode: 'standard',
        subject: 'New subject',
        content: templates[0]!.content,
        plainText: null,
      }),
    );
  });

  it('toggles a template enabled/disabled directly from its summary card', async () => {
    patchMock.mockResolvedValue({ ...templates[0], enabled: false });
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Email verification (website account)').length).toBeGreaterThan(0));

    // The same text also appears as the "Preview email as" select's current value — its
    // ancestor is a Select trigger, not a `[role="button"]` Card, so filtering for a match whose
    // closest `[role="button"]` exists reliably picks the summary card, not the select.
    const card = screen
      .getAllByText('Email verification (website account)')
      .map((el) => el.closest<HTMLElement>('[role="button"]'))
      .find((el): el is HTMLElement => el !== null)!;
    await userEvent.click(within(card).getByRole('switch'));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/email-templates/email_verification', { enabled: false }),
    );
  });

  it('restores the default template after confirming, but Save is disabled once nothing is customized', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));
    // The first (non-customized) template's Restore default is disabled — nothing to restore.
    expect(screen.getByRole('button', { name: 'Restore default' })).toBeDisabled();

    await userEvent.click(screen.getByText('Password reset'));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Reset your password'));
    expect(screen.getByRole('button', { name: 'Restore default' })).toBeEnabled();

    postMock.mockResolvedValue({ ...templates[1], subject: 'Reset your password', mode: 'standard', isCustomized: false });
    await userEvent.click(screen.getByRole('button', { name: 'Restore default' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/email-templates/password_reset/restore-default', {}),
    );
  });

  it('sends a test email to the given address for the selected template', async () => {
    postMock.mockResolvedValue({ sent: true });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));

    await userEvent.type(screen.getByLabelText('Send test email'), 'me@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send test' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/email-templates/email_verification/send-test', {
        to: 'me@example.test',
      }),
    );
  });

  it('a Standard-mode template offers no Developer-mode switch unless Developer Customization is on deployment-wide', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));
    expect(screen.queryByLabelText('Developer mode (raw HTML)')).not.toBeInTheDocument();
  });

  it('a Standard-mode template gets the Developer-mode switch once Developer Customization is on', async () => {
    mockGet(true);
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));
    expect(screen.getByLabelText('Developer mode (raw HTML)')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Developer mode (raw HTML)'));
    expect(screen.getByLabelText('Body HTML')).toBeInTheDocument();
    expect(screen.queryByLabelText('Heading')).not.toBeInTheDocument();
  });

  it('browsing a different design shows a "Use this design" action, which applies it deployment-wide', async () => {
    putMock.mockResolvedValue({
      id: 'b-1',
      module: 'emailBranding',
      data: { designId: 'elegant', developerModeEnabled: false },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Elegant')).toBeInTheDocument());

    // Not shown yet — the active design ("Modern Minimal") has nothing to switch to.
    expect(screen.queryByRole('button', { name: 'Use this design' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Elegant'));

    const useButton = await screen.findByRole('button', { name: 'Use this design' });
    await userEvent.click(useButton);

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith(
        '/api/v1/admin/structured-settings/emailBranding',
        expect.objectContaining({ designId: 'elegant' }),
      ),
    );
  });

  it('switching "Preview email as" changes which content the preview renders, independent of the browsed design', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Preview email as')).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText('Preview email as'));
    await userEvent.click(await screen.findByRole('option', { name: 'Password reset' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/admin/email-templates/password_reset/preview'),
        expect.objectContaining({ mode: 'standard', designId: 'modern-minimal' }),
      ),
    );
  });
});
