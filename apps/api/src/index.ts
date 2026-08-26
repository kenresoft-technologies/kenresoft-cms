import { Hono } from 'hono';
import { createDb } from '@kenresoft/database';

import { createAuth } from './lib/auth';
import { corsMiddleware } from './middleware/cors';
import { requireSession } from './middleware/require-session';
import { securityHeaders } from './middleware/security-headers';
import { publishDueEntries } from './repositories/entries';
import { contentTypesRoute } from './routes/admin/content-types';
import { entriesRoute } from './routes/admin/entries';
import { projectsRoute } from './routes/admin/projects';
import { healthRoute } from './routes/health';
import type { Bindings } from './lib/env';
import type { AuthedVariables } from './middleware/require-session';

const app = new Hono<{ Bindings: Bindings; Variables: AuthedVariables }>();

app.use('*', securityHeaders);
app.use('*', corsMiddleware);

app.route('/api/v1/health', healthRoute);

app.on(['GET', 'POST'], '/api/v1/auth/*', (c) => createAuth(c.env).handler(c.req.raw));

app.use('/api/v1/admin/*', requireSession);
app.route('/api/v1/admin/projects', projectsRoute);
app.route('/api/v1/admin/content-types', contentTypesRoute);
app.route('/api/v1/admin/entries', entriesRoute);

export default {
  fetch: app.fetch,
  // Scheduled publishing (§13): a Cron Trigger (see wrangler.toml [triggers]) periodically
  // transitions draft entries whose publishAt has elapsed to published.
  scheduled: async (_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    const db = createDb(env.DB);
    ctx.waitUntil(publishDueEntries(db));
  },
} satisfies ExportedHandler<Bindings>;
