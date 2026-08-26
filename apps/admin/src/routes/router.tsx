import { createBrowserRouter } from 'react-router';

import { AppLayout } from '@/layouts/AppLayout';
import { ContentTypeDetailPage } from '@/pages/ContentTypeDetailPage';
import { ContentTypesPage } from '@/pages/ContentTypesPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { EntriesPage } from '@/pages/EntriesPage';
import { EntryEditorPage } from '@/pages/EntryEditorPage';
import { LoginPage } from '@/pages/LoginPage';
import { ProjectsPage } from '@/pages/ProjectsPage';

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
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:projectId/content-types', element: <ContentTypesPage /> },
      {
        path: 'projects/:projectId/content-types/:contentTypeId',
        element: <ContentTypeDetailPage />,
      },
      {
        path: 'projects/:projectId/content-types/:contentTypeId/entries',
        element: <EntriesPage />,
      },
      {
        path: 'projects/:projectId/content-types/:contentTypeId/entries/:entryId',
        element: <EntryEditorPage />,
      },
    ],
  },
]);
