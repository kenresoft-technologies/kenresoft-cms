import { OpenAPIHono } from '@hono/zod-openapi';
import type { Env } from 'hono';

// Every OpenAPIHono instance (the top-level app and every migrated sub-app) is constructed
// through this factory so the validation-error response shape stays identical everywhere
// instead of drifting route-by-route. Reproduces parseJsonBody's existing
// { error: 'Validation failed', issues } shape exactly, since apps/api/test/admin-routes.test.ts
// already asserts it for a route this migration touches.
export function createOpenApiApp<E extends Env>() {
  return new OpenAPIHono<E>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'Validation failed', issues: result.error.issues }, 400);
      }
    },
  });
}
