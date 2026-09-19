import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isRouteErrorResponse, useRouteError } from 'react-router';

import kenresoftLogoMark from '@/assets/kenresoft-cms-logo-mark.svg';
import { Button } from '@/components/ui/button';

// A page reporting "Failed to fetch dynamically imported module" (or the equivalent Firefox/
// Safari wording) is the classic symptom of a browser tab left open across a deploy: this app's
// route.lazy()-based code splitting (routes/router.tsx) references chunk files by content hash,
// and a fresh deploy removes the old ones — the tab's already-loaded index.html still points at
// a hash that's now gone. The fix is simply a reload, which fetches the current index.html and
// its up-to-date chunk references; it isn't a real application bug, and showing it as one (React
// Router's own default "Unexpected Application Error!" screen, styled like a raw crash dump) was
// itself the reported problem, not just the error.
const CHUNK_LOAD_ERROR_PATTERN =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return CHUNK_LOAD_ERROR_PATTERN.test(message);
}

// Session-scoped, not persisted — only guards against reloading forever inside one open tab.
// A genuine, reproducible bug (not just a stale chunk reference) still surfaces the real error
// screen below after this one attempt, rather than looping silently. Exported so main.tsx's
// `vite:preloadError` listener shares the same guard rather than reloading twice in a row.
export const CHUNK_RELOAD_GUARD_KEY = 'kenresoft-cms:route-error-auto-reload-attempted';

function errorMessage(error: unknown): string {
  if (isRouteErrorResponse(error)) return error.statusText || `Error ${error.status}`;
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}

// The router's top-level errorElement (routes/router.tsx) — replaces React Router's own bare
// "Unexpected Application Error!" fallback (shown whenever a route, or a route.lazy() import,
// throws and nothing upstream catches it) with a screen matching this app's own design system,
// and auto-recovers the one error class that isn't really an application error at all.
export function RouteErrorBoundary() {
  const error = useRouteError();
  // Derived from `error` plus the guard flag, not separate state — whether this render is about
  // to trigger a reload is knowable synchronously, so the spinner UI and the effect that
  // actually performs the reload (a side effect on an external system, the browser) can both
  // read it directly rather than needing a setState round-trip to agree on it.
  const willAutoReload = isChunkLoadError(error) && !sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY);

  useEffect(() => {
    if (!willAutoReload) return;
    sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, '1');
    window.location.reload();
  }, [willAutoReload]);

  if (willAutoReload) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
        <RefreshCw className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">A newer version of this app is available — reloading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <div className="flex items-center gap-3">
          <img src={kenresoftLogoMark} alt="" className="size-5 brightness-0 invert" />
          <span className="text-xl font-semibold">Kenresoft CMS</span>
        </div>

        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="size-6 text-destructive" />
        </div>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">{errorMessage(error)}</p>
        </div>

        <Button onClick={() => window.location.reload()}>
          <RefreshCw />
          Reload page
        </Button>
      </div>
    </div>
  );
}
