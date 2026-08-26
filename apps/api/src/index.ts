import { Hono } from 'hono';

import { createAuth } from './lib/auth';
import { corsMiddleware } from './middleware/cors';
import { securityHeaders } from './middleware/security-headers';
import { healthRoute } from './routes/health';
import type { Bindings } from './lib/env';

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', securityHeaders);
app.use('*', corsMiddleware);

app.route('/api/v1/health', healthRoute);

app.on(['GET', 'POST'], '/api/v1/auth/*', (c) => createAuth(c.env).handler(c.req.raw));

export default app;
