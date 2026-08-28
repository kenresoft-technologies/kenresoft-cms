import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { createDb } from '@kenresoft/database';

import { createAuth } from './lib/auth';
import { authRateLimit } from './middleware/auth-rate-limit';
import { corsMiddleware } from './middleware/cors';
import { requireSession } from './middleware/require-session';
import { securityHeaders } from './middleware/security-headers';
import { invalidatePublicEntryCache } from './lib/public-cache';
import { getContentTypeById } from './repositories/content-types';
import { publishDueEntries } from './repositories/entries';
import { cacheRoute } from './routes/admin/cache';
import { contentTypesRoute } from './routes/admin/content-types';
import { dashboardRoute } from './routes/admin/dashboard';
import { entriesRoute } from './routes/admin/entries';
import { formsRoute } from './routes/admin/forms';
import { globalVariablesRoute } from './routes/admin/global-variables';
import { mediaRoute } from './routes/admin/media';
import { settingsRoute } from './routes/admin/settings';
import { submissionsRoute } from './routes/admin/submissions';
import { usersRoute } from './routes/admin/users';
import { healthRoute } from './routes/health';
import { publicContentRoute } from './routes/public/content';
import { publicFormsRoute } from './routes/public/forms';
import { publicGlobalVariablesRoute } from './routes/public/global-variables';
import { publicMediaRoute } from './routes/public/media';
import type { Bindings } from './lib/env';
import type { AuthedVariables } from './middleware/require-session';

const app = new OpenAPIHono<{ Bindings: Bindings; Variables: AuthedVariables }>();

app.use('*', securityHeaders);
app.use('*', corsMiddleware);

app.route('/api/v1/health', healthRoute);

app.use('/api/v1/auth/*', authRateLimit);
app.on(['GET', 'POST'], '/api/v1/auth/*', (c) => createAuth(c.env).handler(c.req.raw));

// Mounted before the more general /api/v1/public/:contentType catchall so "forms"/"media"/
// "global-variables" are never ambiguous with a content-type slug.
app.route('/api/v1/public/forms', publicFormsRoute);
app.route('/api/v1/public/media', publicMediaRoute);
app.route('/api/v1/public/global-variables', publicGlobalVariablesRoute);
app.route('/api/v1/public', publicContentRoute);

app.use('/api/v1/admin/*', requireSession);
app.route('/api/v1/admin/dashboard', dashboardRoute);
app.route('/api/v1/admin/cache', cacheRoute);
app.route('/api/v1/admin/content-types', contentTypesRoute);
app.route('/api/v1/admin/entries', entriesRoute);
app.route('/api/v1/admin/media', mediaRoute);
app.route('/api/v1/admin/forms', formsRoute);
app.route('/api/v1/admin/global-variables', globalVariablesRoute);
app.route('/api/v1/admin/submissions', submissionsRoute);
app.route('/api/v1/admin/settings', settingsRoute);
app.route('/api/v1/admin/users', usersRoute);

// Aggregates every route registered via .openapi() across the top-level app and its mounted
// OpenAPIHono sub-apps — routes not yet migrated off plain Hono (§ commit sequence) simply
// don't appear here yet, without breaking anything they still handle requests for.
app.doc('/api/v1/openapi.json', (c) => ({
  openapi: '3.1.0',
  info: {
    title: 'Kenresoft CMS API',
    version: c.env.API_VERSION,
  },
}));

app.get(
  '/api/v1/docs',
  Scalar({
    url: '/api/v1/openapi.json',
    pageTitle: 'Kenresoft CMS API Reference',
  }),
);

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
