import { Clock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { usePurgeCache } from '@/lib/queries/cache';
import { Button } from '@/components/ui/button';
import { SettingsSection } from './shared';

function TtlTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-4">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
        <Clock className="size-4 text-primary" />
      </div>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{value}</p>
      </div>
    </div>
  );
}

// Cloudflare's Cache API (what the public API actually uses, docs/ARCHITECTURE.md §12) has no
// list/enumerate operation — there's no way to show "what's cached right now". These two TTLs
// are the real, hard-coded values from apps/api/src/lib/public-cache.ts, not configurable here
// (they've never needed to be) — shown so the purge button below has real context.
export function CacheSection({ readOnly }: { readOnly: boolean }) {
  const purgeCache = usePurgeCache();

  async function handlePurge() {
    try {
      const result = await purgeCache.mutateAsync();
      toast.success(`Purged ${result.entriesPurged} ${result.entriesPurged === 1 ? 'entry' : 'entries'} and ${result.mediaPurged} media ${result.mediaPurged === 1 ? 'file' : 'files'} from the edge cache`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to purge cache');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Public API cache"
        description="Cloudflare's edge cache for the unauthenticated public API (§12) — invalidated automatically on every relevant write."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TtlTile label="Entries" value="5 minutes" />
          <TtlTile label="Media files" value="1 year (immutable — no edit endpoint)" />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Manual purge"
        description="Re-derives and deletes the cache key for every published entry and media file — for when you don't want to wait out the TTL above."
      >
        {readOnly ? (
          <p className="text-sm text-muted-foreground">Only an admin can purge the cache.</p>
        ) : (
          <div>
            <Button type="button" variant="outline" disabled={purgeCache.isPending} onClick={() => void handlePurge()}>
              <Trash2 />
              {purgeCache.isPending ? 'Purging…' : 'Purge cache now'}
            </Button>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
