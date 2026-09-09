import { OpenAPIHono } from '@hono/zod-openapi';
import type { Env } from 'hono';

// Mirrors apps/api/src/lib/openapi.ts's createOpenApiApp() factory exactly, so a plugin's
// validation-error responses are identical in shape to every Core route's — duplicated here
// rather than imported, since a plugin package must never depend on an app's src/, only the
// reverse.
export function createPluginOpenApiApp<E extends Env>() {
  return new OpenAPIHono<E>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'Validation failed', issues: result.error.issues }, 400);
      }
    },
  });
}
