import { cors } from 'hono/cors';
import type { Context } from 'hono';

import type { Bindings } from '../lib/env';

// Explicit allow-list per docs/ARCHITECTURE.md §9 — never default to "*".
// CORS_ORIGINS is a comma-separated list configured per environment (wrangler.toml [vars]).
export const corsMiddleware = cors({
  origin: (origin, c: Context<{ Bindings: Bindings }>) => {
    const allowList = c.env.CORS_ORIGINS.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    return origin && allowList.includes(origin) ? origin : undefined;
  },
  credentials: true,
});
