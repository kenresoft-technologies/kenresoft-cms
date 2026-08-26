import { Hono } from 'hono';

import { corsMiddleware } from './middleware/cors';
import { securityHeaders } from './middleware/security-headers';
import { healthRoute } from './routes/health';
import type { Bindings } from './lib/env';

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', securityHeaders);
app.use('*', corsMiddleware);

app.route('/api/v1/health', healthRoute);

export default app;
