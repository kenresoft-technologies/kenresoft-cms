import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, patchMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: getMock, patch: patchMock, post: postMock } };
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
    bodyHtml: '<p>Reset {{resetUrl}}</p>',
    plainText: null,
    enabled: false,
    isCustomized: true,
    availableVariables: ['user.name', 'resetUrl'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

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
    getMock.mockResolvedValue(templates);
  });

  it('lists every template with its customized/default and enabled/disabled state', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Email verification (website account)')).toBeInTheDocument());
    expect(screen.getByText('Password reset')).toBeInTheDocument();
    expect(screen.getAllByText('Default')).toHaveLength(1);
    expect(screen.getAllByText('Customized')).toHaveLength(1);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('opens the first template in the editor by default, showing its subject/body/variables', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));
    expect(screen.getByLabelText('Body HTML (Advanced)')).toHaveValue('<p>Verify {{verificationUrl}}</p>');
    expect(screen.getByText('{{verificationUrl}}')).toBeInTheDocument();
    expect(screen.getByText('{{design.brandColor}}')).toBeInTheDocument();
  });

  it('switches the editor to a different template when its card is selected', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));

    await userEvent.click(screen.getByText('Password reset'));

    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Reset your password'));
  });

  it('saves subject/body changes for the selected template', async () => {
    patchMock.mockResolvedValue({ ...templates[0], subject: 'New subject' });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Verify your email address'));

    await userEvent.clear(screen.getByLabelText('Subject'));
    await userEvent.type(screen.getByLabelText('Subject'), 'New subject');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/api/v1/admin/email-templates/email_verification', {
        subject: 'New subject',
        bodyHtml: '<p>Verify {{verificationUrl}}</p>',
        plainText: null,
      }),
    );
  });

  it('toggles a template enabled/disabled directly from its summary card', async () => {
    patchMock.mockResolvedValue({ ...templates[0], enabled: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('Email verification (website account)')).toBeInTheDocument());

    const card = screen.getByText('Email verification (website account)').closest<HTMLElement>('[role="button"]')!;
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

    postMock.mockResolvedValue({ ...templates[1], subject: 'Reset your password', isCustomized: false });
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
});
