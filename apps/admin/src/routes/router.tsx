import { createBrowserRouter } from 'react-router';

import { AllEntriesPage } from '@/pages/AllEntriesPage';
import { AllSubmissionsPage } from '@/pages/AllSubmissionsPage';
import { AppLayout } from '@/layouts/AppLayout';
import { ContentTypeDetailPage } from '@/pages/ContentTypeDetailPage';
import { ContentTypesPage } from '@/pages/ContentTypesPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { EntriesPage } from '@/pages/EntriesPage';
import { EntryEditorPage } from '@/pages/EntryEditorPage';
import { FormDetailPage } from '@/pages/FormDetailPage';
import { FormsPage } from '@/pages/FormsPage';
import { FormSubmissionsPage } from '@/pages/FormSubmissionsPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { GlobalVariablesPage } from '@/pages/GlobalVariablesPage';
import { LoginPage } from '@/pages/LoginPage';
import { MediaLibraryPage } from '@/pages/MediaLibraryPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { RecoverWithCodePage } from '@/pages/RecoverWithCodePage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { UsersPage } from '@/pages/UsersPage';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/forgot-password',
    element: <ForgotPasswordPage />,
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />,
  },
  {
    path: '/recover-with-code',
    element: <RecoverWithCodePage />,
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'entries', element: <AllEntriesPage /> },
      { path: 'content-types', element: <ContentTypesPage /> },
      { path: 'global-variables', element: <GlobalVariablesPage /> },
      { path: 'media', element: <MediaLibraryPage /> },
      { path: 'forms', element: <FormsPage /> },
      { path: 'forms/:formId', element: <FormDetailPage /> },
      { path: 'forms/:formId/submissions', element: <FormSubmissionsPage /> },
      { path: 'submissions', element: <AllSubmissionsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'content-types/:contentTypeId', element: <ContentTypeDetailPage /> },
      { path: 'content-types/:contentTypeId/entries', element: <EntriesPage /> },
      { path: 'content-types/:contentTypeId/entries/:entryId', element: <EntryEditorPage /> },
    ],
  },
]);
