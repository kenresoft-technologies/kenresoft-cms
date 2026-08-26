import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaLibraryPage } from '@/pages/MediaLibraryPage';

const { getMock, uploadMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  uploadMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: getMock, upload: uploadMock, delete: deleteMock },
  };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MediaLibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MediaLibraryPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    uploadMock.mockReset();
    deleteMock.mockReset();
  });

  it('lists uploaded media with dimensions and size', async () => {
    getMock.mockResolvedValue([
      {
        id: 'm-1',
        filename: 'photo.png',
        contentType: 'image/png',
        size: 2048,
        width: 256,
        height: 128,
        altText: null,
      },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText('photo.png')).toBeInTheDocument());
    expect(screen.getByText('256×128 · 2 KB')).toBeInTheDocument();
  });

  it('shows an empty state when there is no media', async () => {
    getMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(screen.getByText('No media yet')).toBeInTheDocument());
  });

  it('uploads a file through the dialog and refetches the list', async () => {
    getMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'm-1',
          filename: 'photo.png',
          contentType: 'image/png',
          size: 1024,
          width: 10,
          height: 10,
          altText: null,
        },
      ]);
    uploadMock.mockResolvedValue({ id: 'm-1' });

    renderPage();
    await waitFor(() => expect(screen.getByText('No media yet')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Upload media' }));
    const dialog = screen.getByRole('dialog');
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('File'), file);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    const [path, formData] = uploadMock.mock.calls[0] as [string, FormData];
    expect(path).toBe('/api/v1/admin/media');
    expect(formData.get('file')).toBe(file);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('deletes a media item after confirming in the alert dialog', async () => {
    getMock.mockResolvedValue([
      {
        id: 'm-1',
        filename: 'photo.png',
        contentType: 'image/png',
        size: 1024,
        width: 10,
        height: 10,
        altText: null,
      },
    ]);
    deleteMock.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(screen.getByText('photo.png')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const alert = await screen.findByRole('alertdialog');
    expect(within(alert).getByText('Delete "photo.png"?')).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/api/v1/admin/media/m-1'));
  });

  it('does not delete when the alert dialog is cancelled', async () => {
    getMock.mockResolvedValue([
      {
        id: 'm-1',
        filename: 'photo.png',
        contentType: 'image/png',
        size: 1024,
        width: 10,
        height: 10,
        altText: null,
      },
    ]);

    renderPage();
    await waitFor(() => expect(screen.getByText('photo.png')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const alert = await screen.findByRole('alertdialog');
    await userEvent.click(within(alert).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
