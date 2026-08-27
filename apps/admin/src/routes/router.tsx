import { createBrowserRouter } from 'react-router';

import { AppLayout } from '@/layouts/AppLayout';
import { ContentTypeDetailPage } from '@/pages/ContentTypeDetailPage';
import { ContentTypesPage } from '@/pages/ContentTypesPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { EntriesPage } from '@/pages/EntriesPage';
import { EntryEditorPage } from '@/pages/EntryEditorPage';
import { FormDetailPage } from '@/pages/FormDetailPage';
import { FormsPage } from '@/pages/FormsPage';
import { FormSubmissionsPage } from '@/pages/FormSubmissionsPage';
import { LoginPage } from '@/pages/LoginPage';
import { MediaLibraryPage } from '@/pages/MediaLibraryPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { UsersPage } from '@/pages/UsersPage';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'content-types', element: <ContentTypesPage /> },
      { path: 'media', element: <MediaLibraryPage /> },
      { path: 'forms', element: <FormsPage /> },
      { path: 'forms/:formId', element: <FormDetailPage /> },
      { path: 'forms/:formId/submissions', element: <FormSubmissionsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'content-types/:contentTypeId', element: <ContentTypeDetailPage /> },
      { path: 'content-types/:contentTypeId/entries', element: <EntriesPage /> },
      { path: 'content-types/:contentTypeId/entries/:entryId', element: <EntryEditorPage /> },
    ],
  },
]);
