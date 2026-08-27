// Single source of truth for the admin API's wire shapes now lives in packages/contracts,
// shared with apps/api's own Zod-validated routes (docs/ARCHITECTURE.md §8/§20 Phase 6) —
// this file is a thin re-export barrel so the ~20 files across this app that already
// `import type {...} from '@/lib/types'` don't need touching individually.
//
// The const-array value import below deliberately reaches past @kenresoft/contracts' own
// barrel (api/index.ts) straight to schemas/enums.ts. Confirmed empirically: importing
// FIELD_TYPES etc. via the barrel — even after splitting enums into their own zod-free file —
// still pulled zod into this app's production bundle, because Rollup didn't fully separate
// individual bindings through the barrel's chain of `export *` re-exports spanning several
// zod-schema-bearing files. A direct path to the one file that never imports zod at all
// sidesteps that entirely — confirmed by grepping the built bundle for ZodError/ZodObject/
// ZodType before and after (present via the barrel, absent via this direct path).
export {
  ENTRY_STATUSES,
  FIELD_TYPES,
  FORM_FIELD_TYPES,
  FORM_SUBMISSION_STATUSES,
  MEDIA_CONTENT_TYPES,
  USER_ROLES,
} from '@kenresoft/contracts/schemas/enums';

// Type-only — fully erased at build regardless of which contracts module defines them, so
// these go through the normal barrel.
export type {
  AdminUser,
  ContentType,
  DashboardStats,
  Entry,
  EntryRevision,
  EntryStatus,
  FieldDefinition,
  FieldType,
  Form,
  FormField,
  FormFieldType,
  FormSubmission,
  FormSubmissionStatus,
  Media,
  MediaContentType,
  Settings,
  UserRole,
} from '@kenresoft/contracts';
