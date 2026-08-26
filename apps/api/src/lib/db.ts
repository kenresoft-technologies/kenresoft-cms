import { createDb } from '@kenresoft/database';
import type { Context } from 'hono';

import type { Bindings } from './env';

export function getDb(c: Context<{ Bindings: Bindings }>) {
  return createDb(c.env.DB);
}
