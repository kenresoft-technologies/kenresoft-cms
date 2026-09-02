import { createDb } from '@kenresoft-cms/database';
import type { Context } from 'hono';

import type { Bindings } from './env';

export function getDb<E extends { Bindings: Bindings }>(c: Context<E>) {
  return createDb(c.env.DB);
}
