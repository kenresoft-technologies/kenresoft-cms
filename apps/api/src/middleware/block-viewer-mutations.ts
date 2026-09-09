import type { MiddlewareHandler } from 'hono';

import type { Bindings } from '../lib/env';
import type { AuthedVariables } from './require-session';

// Applied once, globally, to every /api/v1/admin/* route — viewer is read-only everywhere
// (§10), so this is the one blanket rule rather than adding a requireRole('admin', 'editor',
// 'author') to every existing and future mutation route individually. GET (and HEAD) pass
// through untouched; every other method is a write.
export const blockViewerMutations: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AuthedVariables;
}> = async (c, next) => {
  const isMutation = c.req.method !== 'GET' && c.req.method !== 'HEAD';
  if (isMutation && c.get('user').role === 'viewer') {
    return c.json({ error: 'Viewers cannot make changes' }, 403);
  }
  await next();
};
