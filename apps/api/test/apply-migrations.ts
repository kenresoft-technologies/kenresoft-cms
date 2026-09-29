import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// vitest-pool-workers 0.10+ no longer isolates storage per test (only per file), and many tests
// assume each test starts empty (the first sign-up becomes the owner, lists start empty, fixed
// slugs are reused). Empty every table, the R2 bucket and the edge cache before each test to keep
// that guarantee.
const tables = (
  await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'",
  ).all<{ name: string }>()
).results.map((row) => row.name);

// The Cache API can't list its keys, so record every key written. The Worker under test runs in
// this same isolate, so its cache writes go through this patched method too.
const cachedKeys = new Set<string>();
const cacheProto = Object.getPrototypeOf(caches.default) as Cache;
const originalPut = cacheProto.put;
cacheProto.put = function (this: Cache, request: RequestInfo | URL, response: Response) {
  cachedKeys.add(request instanceof Request ? request.url : String(request));
  return originalPut.call(this, request, response);
};

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('PRAGMA defer_foreign_keys = on'),
    ...tables.map((name) => env.DB.prepare(`DELETE FROM "${name}"`)),
  ]);

  let cursor: string | undefined;
  do {
    const page = await env.MEDIA_BUCKET.list(cursor ? { cursor } : {});
    if (page.objects.length > 0) await env.MEDIA_BUCKET.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  await Promise.all([...cachedKeys].map((key) => caches.default.delete(key)));
  cachedKeys.clear();
});
