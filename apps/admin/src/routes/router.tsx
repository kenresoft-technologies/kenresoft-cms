import { createBrowserRouter } from 'react-router';

import { AppLayout } from '@/layouts/AppLayout';
import { DashboardPage } from '@/pages/DashboardPage';
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
    ],
  },
]);
