import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../schema';

export * from '../schema';

// Re-exported so consumers always operate against the same physical drizzle-orm instance as
// this package's schema objects — pnpm can resolve a second, structurally-incompatible copy
// of drizzle-orm elsewhere in the workspace (peer-dependency-driven instance splitting), and
// TypeScript treats the private/protected internals of Column/SQL as nominally distinct
// across those copies even at an identical version.
export { eq, and, or, asc, desc, sql } from 'drizzle-orm';

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;
