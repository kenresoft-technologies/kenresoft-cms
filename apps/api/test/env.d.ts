import type { D1Migration } from '@cloudflare/vitest-pool-workers';

import type { Bindings } from '../src/lib/env';

// cloudflare:test's `env` is typed as Cloudflare.Env (vitest-pool-workers 0.10+).
declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
