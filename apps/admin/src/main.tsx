import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';

import { queryClient } from '@/lib/query-client';
import { router } from '@/routes/router';
import { ThemeProvider } from '@/lib/theme';
import { CHUNK_RELOAD_GUARD_KEY } from '@/components/route-error-boundary';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

import './index.css';

// A tab left open across a deploy has route.lazy()'s dynamically-imported chunks reference
// content hashes a fresh deploy has since removed — Vite's own runtime fires this event for
// exactly that failure. Reloading fetches the current index.html and up-to-date chunk
// references, fixing it before the error even reaches React Router's error boundary
// (components/route-error-boundary.tsx, which has its own guard for the cases this doesn't
// catch — e.g. a route.lazy() import failing in a way that never fires this specific event).
// Shares route-error-boundary.tsx's own sessionStorage guard so a genuinely broken deploy
// (not just a stale tab) doesn't reload forever — one attempt, then the real error surfaces.
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY)) return;
  sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, '1');
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
