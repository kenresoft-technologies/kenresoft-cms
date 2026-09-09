import type { D1Migration } from '@cloudflare/vitest-pool-workers/config';

import type { Bindings } from '../src/lib/env';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Bindings {
    TEST_MIGRATIONS: D1Migration[];
  }
}
