import { ArrowUpCircle, CheckCircle2, ExternalLink, Info } from 'lucide-react';

import { useSystemVersion } from '@/lib/queries/system';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsSection } from './shared';

const RELEASES_URL = 'https://github.com/kenresoft-technologies/kenresoft-cms/releases';

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

// Which Kenresoft CMS release this deployment runs, and whether a newer one exists
// (docs/RELEASING.md). Read-only: updating happens from the install's own checkout with
// `pnpm run update`, never from the browser — the admin can't deploy code.
export function UpdatesSection({ readOnly }: { readOnly: boolean }) {
  const { data, isPending, isError } = useSystemVersion({ enabled: !readOnly });

  return (
    <SettingsSection
      title="Updates"
      description="The Kenresoft CMS release this deployment runs, and whether a newer one is available."
    >
      {readOnly ? (
        <p className="text-sm text-muted-foreground">Only Admins and Owners can see version and update information.</p>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">Checking…</p>
      ) : isError || !data ? (
        <p className="text-sm text-destructive">Couldn't load version information.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Running</p>
              <p className="text-2xl font-semibold tracking-tight">v{data.version}</p>
            </div>
            {data.updateAvailable ? (
              <Badge className="gap-1">
                <ArrowUpCircle className="size-3.5" />
                Update available
              </Badge>
            ) : data.updateCheck === 'ok' ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="size-3.5" />
                Up to date
              </Badge>
            ) : null}
          </div>

          {data.latest && data.updateAvailable ? (
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <p className="text-sm">
                <span className="font-medium">v{data.latest.version}</span> is available
                {formatDate(data.latest.publishedAt) ? `, released ${formatDate(data.latest.publishedAt)}` : ''}.
              </p>
              <p className="text-sm text-muted-foreground">
                Update from this deployment's own checkout by running{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">pnpm run update</code>. It pulls the release,
                applies its database migrations and redeploys both Workers, then shows what changed.
              </p>
              <div>
                <Button asChild variant="outline" size="sm">
                  <a href={data.latest.url} target="_blank" rel="noreferrer">
                    Release notes
                    <ExternalLink />
                  </a>
                </Button>
              </div>
            </div>
          ) : null}

          {data.updateCheck === 'disabled' ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" />
              Checking for new releases is turned off for this deployment (UPDATE_CHECK_REPO).
            </p>
          ) : data.updateCheck === 'unavailable' ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" />
              Couldn't check for a newer release right now. It's retried automatically within the hour.
            </p>
          ) : null}

          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
          >
            All releases
            <ExternalLink className="size-3.5" />
          </a>
        </>
      )}
    </SettingsSection>
  );
}
