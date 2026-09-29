import type { Database } from '@kenresoft-cms/database';
import { createDb } from '@kenresoft-cms/database';
import type { MiddlewareHandler } from 'hono';

import { enqueueCachePurgePaths, processCachePurgeQueue } from './cache-purge';
import { dispatchWebhookEvent } from './webhooks';
import { getContentTypeById } from '../repositories/content-types';
import { publishDueEntries } from '../repositories/entries';
import { publishDuePages } from '../repositories/pages';
import type { Bindings } from './env';

type Ctx = Pick<ExecutionContext, 'waitUntil'>;

// Transitions every draft entry/page whose publishAt has elapsed to published, then invalidates
// the public cache and fires webhooks for what changed. Called by the Cron Trigger (every 5 min)
// and, throttled, from request traffic (see opportunisticPublishSweep) — the cron alone never
// fires under `wrangler dev`, and can lag a schedule by up to five minutes on a deployment.
//
// Each stage is isolated: a failure in one (a poison entry, a cache-purge hiccup) is logged and
// never stops the stages after it, so one bad row can't hold every other scheduled item hostage.
export async function runScheduledPublishing(db: Database, ctx: Ctx): Promise<void> {
  try {
    const published = await publishDueEntries(db);
    // Newly-published entries invalidate the public API cache the same way an admin edit does
    // (§12/§13) — otherwise a cached "not published yet" response could outlive the auto-publish
    // by up to the cache TTL. Queued rather than invalidated directly, since an unusually large
    // batch becoming due in one tick could exceed a Worker invocation's subrequest budget — see
    // lib/cache-purge.ts.
    if (published.length > 0) {
      const paths = new Set<string>();
      for (const entry of published) {
        const contentType = await getContentTypeById(db, entry.contentTypeId);
        if (!contentType) continue;
        paths.add(`/api/v1/public/${contentType.slug}`);
        paths.add(`/api/v1/public/${contentType.slug}/${entry.slug}`);
      }
      if (paths.size > 0) await enqueueCachePurgePaths(db, Array.from(paths));
      for (const entry of published) {
        dispatchWebhookEvent(db, ctx, 'entry.published', entry.contentTypeId, {
          entryId: entry.id,
          contentTypeId: entry.contentTypeId,
          slug: entry.slug,
          status: entry.status,
        });
      }
    }
  } catch (error) {
    console.error('Scheduled publishing failed for entries:', error);
  }

  try {
    // Pages reuse this same sweep verbatim (docs/SITE_BUILDER.md §3.1/§13).
    const publishedPages = await publishDuePages(db);
    if (publishedPages.length > 0) {
      const pagePaths = new Set<string>(['/api/v1/public/pages']);
      for (const page of publishedPages) {
        pagePaths.add(`/api/v1/public/pages/by-route?route=${encodeURIComponent(page.route)}`);
      }
      await enqueueCachePurgePaths(db, Array.from(pagePaths));
    }
  } catch (error) {
    console.error('Scheduled publishing failed for pages:', error);
  }

  try {
    // Continues whichever cache-purge job has been waiting longest — one bounded batch per run.
    await processCachePurgeQueue(db);
  } catch (error) {
    console.error('Cache purge queue processing failed:', error);
  }
}

const SWEEP_INTERVAL_MS = 30_000;
let lastSweepAt = 0;

// Test-only: the throttle is module state that outlives a single test.
export function resetPublishSweepThrottle(): void {
  lastSweepAt = 0;
}

// Runs the sweep at most once per SWEEP_INTERVAL_MS per isolate, on the way through a request, so a
// scheduled item goes live within about a minute of its time whenever the site has any traffic —
// and works under `wrangler dev`, where Cron Triggers never fire. Awaited inline rather than
// waitUntil'd: it's one indexed SELECT when nothing is due, and finishing before the response
// keeps its writes inside the request. Never throws into the request.
export const opportunisticPublishSweep: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const now = Date.now();
  if (c.req.method === 'GET' && now - lastSweepAt >= SWEEP_INTERVAL_MS) {
    lastSweepAt = now;
    try {
      await runScheduledPublishing(createDb(c.env.DB), c.executionCtx);
    } catch (error) {
      console.error('Opportunistic publish sweep failed:', error);
    }
  }
  await next();
};
