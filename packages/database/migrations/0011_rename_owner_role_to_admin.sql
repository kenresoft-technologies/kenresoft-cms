-- Role model expansion: owner/editor -> admin/editor/author/viewer. Only the value 'owner'
-- ever existed before this migration (the bootstrap hook and every role-change route only
-- ever assigned 'owner' or 'editor') — this rewrites it to 'admin', its direct successor.
-- 'author' and 'viewer' are new roles with no prior rows to migrate.
UPDATE "user" SET "role" = 'admin' WHERE "role" = 'owner';
