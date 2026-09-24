import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
    name: 'Email verification',
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
  { id: 'cloudflare-inspired', name: 'Dark Technical', description: 'A dark, high-contrast layout.' },
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

  it('lists every email type as a tab, flagging a disabled one', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /Email verification/ })).toBeInTheDocument());
    const passwordResetTab = screen.getByRole('button', { name: /Password reset/ });
    expect(passwordResetTab).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('opens the first (Standard-mode) email by default, showing plain content fields, a design gallery, and exactly one live preview', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));
    expect(screen.getByLabelText('Heading')).toHaveValue('Verify your email address');
    expect(screen.getByLabelText('Message')).toHaveValue(templates[0]!.content.bodyText);
    expect(screen.getByLabelText('Button label')).toHaveValue('Verify email');
    expect(screen.queryByLabelText('Body HTML')).not.toBeInTheDocument();
    expect(screen.queryByText('{{verificationUrl}}')).not.toBeInTheDocument();

    // The design gallery shows real rendered thumbnails, and there is exactly one primary
    // "Email preview" — no second, competing preview anywhere on the page.
    expect(screen.getByText('Modern Minimal')).toBeInTheDocument();
    expect(screen.getByText('Dark Technical')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTitle(/thumbnail/).length).toBeGreaterThanOrEqual(5));
    expect(screen.getAllByTitle('Email preview')).toHaveLength(1);
  });

  it('switches to a different email via its tab, showing that email\'s own content and, for a Developer-mode email, its raw HTML with no design gallery', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));

    await userEvent.click(screen.getByRole('button', { name: /Password reset/ }));

    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Reset your password'));
    expect(screen.getByLabelText('Body HTML')).toHaveValue('<p>Reset {{resetUrl}}</p>');
    expect(screen.getByText('{{resetUrl}}')).toBeInTheDocument();
    // This email uses custom HTML, so no design is applicable to it specifically.
    expect(screen.queryByText('Modern Minimal')).not.toBeInTheDocument();
    // The preview iframe only mounts once the debounced Developer-mode preview call resolves.
    await waitFor(() => expect(screen.getAllByTitle('Email preview')).toHaveLength(1));
  });

  it('saves structured content changes for a Standard-mode email', async () => {
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

  it('toggles an email enabled/disabled immediately, without a separate save step', async () => {
    patchMock.mockResolvedValue({ ...templates[0], enabled: false });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Enabled')).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText('Enabled'));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/email-templates/email_verification', { enabled: false }),
    );
  });

  it('restores the default email after confirming, but Save is disabled once nothing is customized', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));
    // The first (non-customized) email's Restore default is disabled — nothing to restore.
    expect(screen.getByRole('button', { name: 'Restore default' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /Password reset/ }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Reset your password'));
    expect(screen.getByRole('button', { name: 'Restore default' })).toBeEnabled();

    postMock.mockResolvedValue({ ...templates[1], subject: 'Reset your password', mode: 'standard', isCustomized: false });
    await userEvent.click(screen.getByRole('button', { name: 'Restore default' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/email-templates/password_reset/restore-default', {}),
    );
  });

  it('sends a test email to the given address for the selected email', async () => {
    postMock.mockResolvedValue({ sent: true });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));

    await userEvent.type(screen.getByLabelText('Send a test email'), 'me@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send test' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/api/v1/admin/email-templates/email_verification/send-test', {
        to: 'me@example.test',
      }),
    );
  });

  it('offers no way to switch a Standard-mode email to custom HTML unless Developer options is on deployment-wide', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));
    expect(screen.queryByText('Use custom HTML for this email instead of the fields below')).not.toBeInTheDocument();
  });

  it('a Standard-mode email gets the custom-HTML switch once Developer options is on', async () => {
    mockGet(true);
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));
    const toggle = screen.getByLabelText('Use custom HTML for this email instead of the fields below');
    expect(toggle).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.getByLabelText('Body HTML')).toBeInTheDocument();
    expect(screen.queryByLabelText('Heading')).not.toBeInTheDocument();
  });

  it('a Developer-mode email\'s own custom-HTML switch stays visible even when Developer options is off deployment-wide', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));

    await userEvent.click(screen.getByRole('button', { name: /Password reset/ }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Reset your password'));

    expect(screen.getByLabelText('Use custom HTML for this email instead of the fields below')).toBeChecked();
  });

  it('selecting a different design in the gallery shows a "Use this design" action, which applies it to every system email', async () => {
    putMock.mockResolvedValue({
      id: 'b-1',
      module: 'emailBranding',
      data: { designId: 'elegant', developerModeEnabled: false },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Elegant')).toBeInTheDocument());

    // Not shown yet — the in-use design ("Modern Minimal") has nothing to switch to.
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

  it('switching the email tab changes what the one live preview renders', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));

    await userEvent.click(screen.getByRole('button', { name: /Password reset/ }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/api/v1/admin/email-templates/password_reset/preview',
        expect.objectContaining({ mode: 'developer', bodyHtml: '<p>Reset {{resetUrl}}</p>' }),
      ),
    );
  });
});
