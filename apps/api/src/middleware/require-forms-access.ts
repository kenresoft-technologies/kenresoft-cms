import { roleAtLeast } from '@kenresoft-cms/contracts';
import type { MiddlewareHandler } from 'hono';

import type { Bindings } from '../lib/env';
import type { AuthedVariables } from './require-session';

// Forms/Submissions carry visitor-submitted PII and can trigger arbitrary outbound email
// (submission-reply, notification recipients) — closer to this codebase's own Users/webhooks
// sensitivity than day-to-day content editing, so this domain deliberately does NOT follow the
// same role floor Entries use (Author: read everything, write only your own). Per
// docs/ARCHITECTURE.md §10, Author gets NO Forms/Submissions access at all, not even read,
// while Viewer keeps its normal read-only access to every admin route. That combination
// (Author excluded, the strictly-lower-ranked Viewer included for reads) isn't expressible as a
// single ROLE_RANK floor, so it's a small dedicated check rather than `requireRole(...)`.
// Individual routes may still layer a stricter `requireRole('admin')`/`requireRole('admin',
// 'editor')` on top of this for their own write gates — this only ever widens or narrows the
// read/author boundary, never loosens an existing stricter route-level gate.
export function requireFormsAccess(): MiddlewareHandler<{ Bindings: Bindings; Variables: AuthedVariables }> {
  return async (c, next) => {
    const role = c.get('user').role;
    if (roleAtLeast(role, 'editor')) {
      return next();
    }
    if (role === 'viewer' && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
      return next();
    }
    return c.json({ error: 'Forbidden' }, 403);
  };
}
