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

// Each request processes one bounded batch (apps/api/src/lib/cache-purge.ts) rather than every
// cache key in one shot, so a catalog bigger than one batch needs more than one call to finish.
// Looping here keeps that an implementation detail for a normal-sized catalog (still one click,
// just a few requests behind the scenes) while a very large one still converges without the
// admin needing to know to click again — it just finishes over the background 5-minute Cron
// Trigger instead once this cap is hit.
const MAX_PURGE_ROUNDS = 20;

export function CacheSection({ readOnly }: { readOnly: boolean }) {
  const purgeCache = usePurgeCache();

  async function handlePurge() {
    try {
      let result = await purgeCache.mutateAsync();
      let rounds = 1;
      while (!result.done && rounds < MAX_PURGE_ROUNDS) {
        result = await purgeCache.mutateAsync();
        rounds++;
      }
      if (result.done) {
        toast.success(`Purged ${result.totalItems} ${result.totalItems === 1 ? 'cache key' : 'cache keys'} from the edge cache`);
      } else {
        toast.info(
          `Purged ${result.processedItems} of ${result.totalItems} cache keys so far — the rest will finish automatically in the background`,
        );
      }
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
        description="Re-derives and deletes the cache key for every published entry and media file, in bounded batches — for when you don't want to wait out the TTL above."
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
