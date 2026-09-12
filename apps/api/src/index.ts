import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { createDb } from '@kenresoft-cms/database';

import { createAuth } from './lib/auth';
import { authRateLimit } from './middleware/auth-rate-limit';
import { blockViewerMutations } from './middleware/block-viewer-mutations';
import { corsMiddleware } from './middleware/cors';
import { publicContentRateLimit } from './middleware/public-content-rate-limit';
import { requireSession } from './middleware/require-session';
import { securityHeaders } from './middleware/security-headers';
import { enqueueCachePurgePaths, processCachePurgeQueue } from './lib/cache-purge';
import { dispatchWebhookEvent, retryFailedWebhookDeliveries } from './lib/webhooks';
import { mountPlugins } from './plugins/mount';
import { getContentTypeById } from './repositories/content-types';
import { publishDueEntries } from './repositories/entries';
import { publishDuePages } from './repositories/pages';
import { auditLogRoute } from './routes/admin/audit-log';
import { cacheRoute } from './routes/admin/cache';
import { contentTypesRoute } from './routes/admin/content-types';
import { dashboardRoute } from './routes/admin/dashboard';
import { entriesRoute } from './routes/admin/entries';
import { formsRoute } from './routes/admin/forms';
import { globalVariablesRoute } from './routes/admin/global-variables';
import { mediaRoute } from './routes/admin/media';
import { pagesRoute } from './routes/admin/pages';
import { pluginsRoute } from './routes/admin/plugins';
import { securityRoute } from './routes/admin/security';
import { settingsRoute } from './routes/admin/settings';
import { structuredSettingsRoute } from './routes/admin/structured-settings';
import { submissionsRoute } from './routes/admin/submissions';
import { usersRoute } from './routes/admin/users';
import { webhooksRoute } from './routes/admin/webhooks';
import { healthRoute } from './routes/health';
import { publicContentRoute } from './routes/public/content';
import { publicFormsRoute } from './routes/public/forms';
import { publicGlobalVariablesRoute } from './routes/public/global-variables';
import { publicMediaRoute } from './routes/public/media';
import { publicPagesRoute } from './routes/public/pages';
import { publicPasswordResetRoute } from './routes/public/password-reset';
import { publicPreviewRoute } from './routes/public/preview';
import { publicRecoveryRoute } from './routes/public/recovery';
import { publicRoutePatternsRoute } from './routes/public/route-patterns';
import { publicStructuredSettingsRoute } from './routes/public/structured-settings';
import { systemRoute } from './routes/system/recover-owner';
import type { Bindings } from './lib/env';
import type { AuthedVariables } from './middleware/require-session';

const app = new OpenAPIHono<{ Bindings: Bindings; Variables: AuthedVariables }>();

app.use('*', securityHeaders);
app.use('*', corsMiddleware);

app.route('/api/v1/health', healthRoute);

app.use('/api/v1/auth/*', authRateLimit);
app.on(['GET', 'POST'], '/api/v1/auth/*', (c) => createAuth(c.env, c.executionCtx).handler(c.req.raw));

// A loose baseline (300/60s) across every /api/v1/public/* route, layered under the tighter,
// purpose-specific limiters forms/password-reset/recovery already have below — this one closes
// the gap for the routes that had none at all (content, media, global-variables).
app.use('/api/v1/public/*', publicContentRateLimit);

// Mounted before the more general /api/v1/public/:contentType catchall so "forms"/"media"/
// "global-variables" are never ambiguous with a content-type slug.
app.route('/api/v1/public/forms', publicFormsRoute);
app.route('/api/v1/public/media', publicMediaRoute);
app.route('/api/v1/public/global-variables', publicGlobalVariablesRoute);
app.route('/api/v1/public/password-reset', publicPasswordResetRoute);
app.route('/api/v1/public/recovery', publicRecoveryRoute);
app.route('/api/v1/public/preview', publicPreviewRoute);
app.route('/api/v1/public/settings', publicStructuredSettingsRoute);
app.route('/api/v1/public/route-patterns', publicRoutePatternsRoute);
app.route('/api/v1/public/pages', publicPagesRoute);
app.route('/api/v1/public', publicContentRoute);

// Not under /admin (unauthenticated by design) or /public (not a normal content route) —
// see routes/system/recover-owner.ts for why this 404s outright on any deployment that
// hasn't explicitly opted in.
app.route('/api/v1/system', systemRoute);

app.use('/api/v1/admin/*', requireSession);
app.use('/api/v1/admin/*', blockViewerMutations);
app.route('/api/v1/admin/dashboard', dashboardRoute);
app.route('/api/v1/admin/audit-log', auditLogRoute);
app.route('/api/v1/admin/cache', cacheRoute);
app.route('/api/v1/admin/content-types', contentTypesRoute);
app.route('/api/v1/admin/entries', entriesRoute);
app.route('/api/v1/admin/pages', pagesRoute);
app.route('/api/v1/admin/media', mediaRoute);
app.route('/api/v1/admin/forms', formsRoute);
app.route('/api/v1/admin/global-variables', globalVariablesRoute);
app.route('/api/v1/admin/submissions', submissionsRoute);
app.route('/api/v1/admin/settings', settingsRoute);
app.route('/api/v1/admin/structured-settings', structuredSettingsRoute);
app.route('/api/v1/admin/users', usersRoute);
app.route('/api/v1/admin/security', securityRoute);
app.route('/api/v1/admin/webhooks', webhooksRoute);
app.route('/api/v1/admin/plugins', pluginsRoute);

// Every enabled plugin (docs/PLUGINS.md), mounted at /api/plugins/<id>/v1/* — the registry/
// enablement config live under ./plugins/, never imported by this file directly (only
// mountPlugins() itself is), so Core never accumulates a hard-coded dependency on any specific
// plugin's business logic.
mountPlugins(app);

// Aggregates every route registered via .openapi() across the top-level app and its mounted
// OpenAPIHono sub-apps — routes not yet migrated off plain Hono (§ commit sequence) simply
// don't appear here yet, without breaking anything they still handle requests for.
//
// Both routes 404 indistinguishably from not existing when API_DOCS_ENABLED is explicitly set
// to "false" — an operator opt-out for a deployment that would rather not expose its full,
// including authenticated-route, API surface to anonymous requests. Defaults to enabled so
// local dev and every deployment that hasn't touched this setting keep working unchanged.
app.use('/api/v1/openapi.json', async (c, next) => {
  if (c.env.API_DOCS_ENABLED === 'false') return c.notFound();
  await next();
});
app.use('/api/v1/docs', async (c, next) => {
  if (c.env.API_DOCS_ENABLED === 'false') return c.notFound();
  await next();
});

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
        // Newly-published entries invalidate the public API cache the same way an admin edit
        // does (§12/§13) — otherwise a cached "not published yet" response could outlive the
        // auto-publish by up to the cache TTL. Queued rather than invalidated directly (as a
        // single admin edit still is, just two keys) since an unusually large batch of entries
        // becoming due in the same tick could otherwise exceed a Worker invocation's subrequest
        // budget the same way the manual "Purge Cache" button used to — see lib/cache-purge.ts.
        if (published.length > 0) {
          const paths = new Set<string>();
          for (const entry of published) {
            const contentType = await getContentTypeById(db, entry.contentTypeId);
            if (!contentType) continue;
            paths.add(`/api/v1/public/${contentType.slug}`);
            paths.add(`/api/v1/public/${contentType.slug}/${entry.slug}`);
          }
          if (paths.size > 0) await enqueueCachePurgePaths(db, Array.from(paths));
        }
        for (const entry of published) {
          dispatchWebhookEvent(db, ctx, 'entry.published', entry.contentTypeId, {
            entryId: entry.id,
            contentTypeId: entry.contentTypeId,
            slug: entry.slug,
            status: entry.status,
          });
        }
        // Pages reuse this same sweep verbatim (docs/SITE_BUILDER.md §3.1/§13) — a due draft
        // Page transitions to published on the same cadence as a due draft Entry.
        const publishedPages = await publishDuePages(db);
        if (publishedPages.length > 0) {
          const pagePaths = new Set<string>(['/api/v1/public/pages']);
          for (const page of publishedPages) {
            pagePaths.add(`/api/v1/public/pages/by-route?route=${encodeURIComponent(page.route)}`);
          }
          await enqueueCachePurgePaths(db, Array.from(pagePaths));
        }
        // Continues whichever cache-purge job has been waiting longest — a manual "Purge
        // Cache" click, a bulk import, or the enqueue just above, whichever is oldest — one
        // bounded batch per tick, draining the queue in the background without anyone needing
        // to keep re-clicking.
        await processCachePurgeQueue(db);
      })(),
    );
    // Retries failed webhook deliveries on the same 5-minute cadence as scheduled publishing
    // above, rather than introducing a second Cron Trigger or a queue for this — see
    // lib/webhooks.ts for the retry/attempt-limit logic itself.
    ctx.waitUntil(retryFailedWebhookDeliveries(db, ctx));
  },
} satisfies ExportedHandler<Bindings>;
