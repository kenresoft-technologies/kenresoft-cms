import { createBrowserRouter } from 'react-router';

import { AppLayout } from '@/layouts/AppLayout';

// Every page is a separate chunk, downloaded only when its route is actually visited —
// apps/admin's bundle had grown to ~1.9MB as one chunk (Vite's 500kB warning threshold),
// dominated by page-specific dependencies that most sessions never touch on first load:
// Tiptap's full extension set (EntryEditorPage, ~800kB+ of the total on its own — tables,
// code-block syntax highlighting via lowlight, turndown/marked for the Markdown round trip)
// and Recharts (DashboardPage only). `route.lazy` (not `React.lazy` + `Suspense`) is React
// Router's own data-router mechanism for this — it keeps the previous page on screen during
// the fetch rather than needing a manual fallback UI.
export const router = createBrowserRouter([
  {
    path: '/login',
    lazy: async () => ({ Component: (await import('@/pages/LoginPage')).LoginPage }),
  },
  {
    path: '/forgot-password',
    lazy: async () => ({
      Component: (await import('@/pages/ForgotPasswordPage')).ForgotPasswordPage,
    }),
  },
  {
    path: '/reset-password',
    lazy: async () => ({ Component: (await import('@/pages/ResetPasswordPage')).ResetPasswordPage }),
  },
  {
    path: '/recover-with-code',
    lazy: async () => ({
      Component: (await import('@/pages/RecoverWithCodePage')).RecoverWithCodePage,
    }),
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('@/pages/DashboardPage')).DashboardPage }),
      },
      {
        path: 'entries',
        lazy: async () => ({ Component: (await import('@/pages/AllEntriesPage')).AllEntriesPage }),
      },
      {
        path: 'content-types',
        lazy: async () => ({
          Component: (await import('@/pages/ContentTypesPage')).ContentTypesPage,
        }),
      },
      {
        path: 'global-variables',
        lazy: async () => ({
          Component: (await import('@/pages/GlobalVariablesPage')).GlobalVariablesPage,
        }),
      },
      {
        path: 'media',
        lazy: async () => ({
          Component: (await import('@/pages/MediaLibraryPage')).MediaLibraryPage,
        }),
      },
      {
        path: 'forms',
        lazy: async () => ({ Component: (await import('@/pages/FormsPage')).FormsPage }),
      },
      {
        path: 'forms/:formId',
        lazy: async () => ({ Component: (await import('@/pages/FormDetailPage')).FormDetailPage }),
      },
      {
        path: 'forms/:formId/submissions',
        lazy: async () => ({
          Component: (await import('@/pages/FormSubmissionsPage')).FormSubmissionsPage,
        }),
      },
      {
        path: 'submissions',
        lazy: async () => ({
          Component: (await import('@/pages/AllSubmissionsPage')).AllSubmissionsPage,
        }),
      },
      {
        path: 'settings',
        lazy: async () => ({ Component: (await import('@/pages/SettingsPage')).SettingsPage }),
      },
      {
        path: 'users',
        lazy: async () => ({ Component: (await import('@/pages/UsersPage')).UsersPage }),
      },
      {
        path: 'profile',
        lazy: async () => ({ Component: (await import('@/pages/ProfilePage')).ProfilePage }),
      },
      {
        path: 'content-types/:contentTypeId',
        lazy: async () => ({
          Component: (await import('@/pages/ContentTypeDetailPage')).ContentTypeDetailPage,
        }),
      },
      {
        path: 'content-types/:contentTypeId/entries',
        lazy: async () => ({ Component: (await import('@/pages/EntriesPage')).EntriesPage }),
      },
      {
        path: 'content-types/:contentTypeId/entries/:entryId',
        lazy: async () => ({
          Component: (await import('@/pages/EntryEditorPage')).EntryEditorPage,
        }),
      },
    ],
  },
]);
