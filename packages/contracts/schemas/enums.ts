// Every enum array consumed as a runtime value somewhere (apps/admin renders several of these
// as <Select> options; apps/api's validators build z.enum(...) from them) lives in this one
// module, deliberately with zero zod import — every domain schema file below imports its enum
// from here rather than declaring it locally. Splitting this out isn't just organizational: a
// domain file that both defines an enum AND builds zod schemas from it can't be safely
// tree-shaken by Rollup — z.object(...) call expressions are opaque, non-provably-pure
// function calls, so importing just the enum from such a file still pulls the whole module
// (zod included) into whatever bundle imports it. Confirmed empirically once during the
// packages/contracts + @hono/zod-openapi migration: apps/admin's production bundle contained
// ZodError/ZodObject/ZodType even though its own code only ever did `export type` re-exports —
// the leak came from re-exporting FIELD_TYPES etc. out of files that also called z.object(...)
// at module scope. This file exists so that never happens again.

export const FIELD_TYPES = [
  'text',
  'textarea',
  'rich_text',
  'number',
  'boolean',
  'date',
  'datetime',
  'slug',
  'email',
  'url',
  'select',
  'multi_select',
  'media',
  'reference',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const ENTRY_STATUSES = ['draft', 'published'] as const;

export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'email',
  'url',
  'number',
  'select',
  'checkbox',
  'date',
  'file',
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FORM_SUBMISSION_STATUSES = ['new', 'read', 'archived'] as const;

export type FormSubmissionStatus = (typeof FORM_SUBMISSION_STATUSES)[number];

// Raster image types accepted for V1 (§14) — verified against the file's actual bytes at
// upload time, not the client-supplied Content-Type (§9: never trust browser-provided MIME
// types alone). Other media (PDF/doc, etc.) is future work.
export const MEDIA_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export type MediaContentType = (typeof MEDIA_CONTENT_TYPES)[number];

// owner: represents ownership of this specific installation — everything admin can do, plus
// immune to every other role's user-management actions (an admin can never demote, delete, or
// disable an owner; only the owner can transfer ownership). Not tied to Kenresoft or any
// external account — purely a per-deployment role like every other one here. admin: everything,
// including structure (content types, forms), users, roles, settings, cache — but never an
// owner. editor: everything editorial — any entry, form submission triage, media, content-type
// and form FIELDS (not the content type/form's own existence) — no structure/users/settings.
// author: entries they created only (create freely, edit/delete only their own); can't manage
// media, forms, or structure. viewer: read-only everywhere, no writes at all. The first signup
// on a deployment becomes owner (src/lib/auth.ts's bootstrap hook); everyone after defaults to
// editor. Renamed from the original two-role ('owner'/'editor') model — packages/database's
// 0011 migration rewrote every existing 'owner' row to 'admin' during the admin/editor/author/
// viewer expansion; a later migration reintroduces 'owner' as a real, distinct role above admin
// (docs/ARCHITECTURE.md §10).
export const USER_ROLES = ['owner', 'admin', 'editor', 'author', 'viewer'] as const;

export type UserRole = (typeof USER_ROLES)[number];

// Higher number = more privilege. Centralizes what used to be ~19 hand-copied exact-string
// role comparisons across apps/api and apps/admin into one ranked comparison — requireRole()
// (apps/api/src/middleware/require-role.ts) and apps/admin's roleAtLeast() both key off this,
// so introducing 'owner' above 'admin' didn't require touching every one of those call sites:
// any check already written as "admin or above" (every requireRole('admin', ...) site verified
// to be a contiguous top slice, never a non-contiguous set) automatically admits owner too.
export const ROLE_RANK: Record<UserRole, number> = {
  viewer: 0,
  author: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

export function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

// Fired from apps/api/src/routes/admin/entries.ts at the route layer (not the repository),
// since only the route handler has both the pre-update and post-update entry to compare
// statuses against — "updated" always fires alongside "published"/"unpublished" on a status-
// changing update, so a webhook subscriber who only wants "anything changed" has one reliable
// event to listen for without also having to know about the more specific ones.
export const WEBHOOK_EVENTS = ['entry.created', 'entry.updated', 'entry.published', 'entry.unpublished', 'entry.deleted'] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
