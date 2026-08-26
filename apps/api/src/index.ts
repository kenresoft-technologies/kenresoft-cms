import { Hono } from 'hono';

import { createAuth } from './lib/auth';
import { corsMiddleware } from './middleware/cors';
import { requireSession } from './middleware/require-session';
import { securityHeaders } from './middleware/security-headers';
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

export default app;
