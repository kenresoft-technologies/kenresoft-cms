import { Hono } from 'hono';
import { createDb } from '@kenresoft/database';

import { createAuth } from './lib/auth';
import { corsMiddleware } from './middleware/cors';
import { requireSession } from './middleware/require-session';
import { securityHeaders } from './middleware/security-headers';
import { invalidatePublicEntryCache } from './lib/public-cache';
import { getContentTypeById } from './repositories/content-types';
import { publishDueEntries } from './repositories/entries';
import { contentTypesRoute } from './routes/admin/content-types';
import { entriesRoute } from './routes/admin/entries';
import { mediaRoute } from './routes/admin/media';
import { healthRoute } from './routes/health';
import { publicContentRoute } from './routes/public/content';
import type { Bindings } from './lib/env';
import type { AuthedVariables } from './middleware/require-session';

const app = new Hono<{ Bindings: Bindings; Variables: AuthedVariables }>();

app.use('*', securityHeaders);
app.use('*', corsMiddleware);

app.route('/api/v1/health', healthRoute);

app.on(['GET', 'POST'], '/api/v1/auth/*', (c) => createAuth(c.env).handler(c.req.raw));

app.route('/api/v1/public', publicContentRoute);

app.use('/api/v1/admin/*', requireSession);
app.route('/api/v1/admin/content-types', contentTypesRoute);
app.route('/api/v1/admin/entries', entriesRoute);
app.route('/api/v1/admin/media', mediaRoute);

export default {
  fetch: app.fetch,
  // Scheduled publishing (§13): a Cron Trigger (see wrangler.toml [triggers]) periodically
  // transitions draft entries whose publishAt has elapsed to published.
  scheduled: async (_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    const db = createDb(env.DB);
    ctx.waitUntil(
      (async () => {
        const published = await publishDueEntries(db);
        // Newly-published entries invalidate the public API cache the same way an admin
        // edit does (§12/§13) — otherwise a cached "not published yet" response could
        // outlive the auto-publish by up to the cache TTL.
        await Promise.all(
          published.map(async (entry) => {
            const contentType = await getContentTypeById(db, entry.contentTypeId);
            if (!contentType) return;
            await invalidatePublicEntryCache(contentType.slug, entry.slug);
          }),
        );
      })(),
    );
  },
} satisfies ExportedHandler<Bindings>;
