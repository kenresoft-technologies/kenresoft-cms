-- Owner role introduction (docs/ARCHITECTURE.md §10): promotes the single oldest existing
-- admin to owner, so no deployment upgrades into having zero owners. Only ever touches that one
-- row — every other existing admin stays admin. No-op if an owner already exists (safe to
-- re-run) or if there's no admin yet (a genuinely empty user table, i.e. a fresh install, which
-- gets its owner from src/lib/auth.ts's bootstrap hook on first signup instead).
UPDATE "user" SET "role" = 'owner'
WHERE "id" = (SELECT "id" FROM "user" WHERE "role" = 'admin' ORDER BY "created_at" ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "user" WHERE "role" = 'owner');
