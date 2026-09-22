import { z } from 'zod';

import { ACCOUNT_ROLES } from './enums';

// The Core Users directory's one row shape — every account with access to this deployment,
// website users and CMS staff alike (docs/ARCHITECTURE.md §10). `role`/`isCommerceCustomer`
// together classify an account: role 'none' + isCommerceCustomer false = a plain website user
// with no purchases yet; role 'none' + isCommerceCustomer true = a Commerce customer; any real
// CMS role = CMS staff (who can also, independently, have made purchases).
export const adminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  // 'none' = a website user with no CMS access.
  role: z.enum(ACCOUNT_ROLES),
  disabled: z.boolean(),
  // Whether this account has completed better-auth's email-verification flow
  // (apps/api/src/lib/auth.ts) — an account can't sign in until this is true, regardless of
  // role. Surfaced on the Users page so an owner/admin can see who hasn't verified yet.
  emailVerified: z.boolean(),
  // Per-user Developer panel grant, independent of role for editor/author (owner/admin always
  // qualify regardless of this value — see apps/admin/src/lib/developer-mode.ts).
  developerToolsAccess: z.boolean(),
  // Derived from plugin_commerce_customer_profiles, never a stored column on `user` itself —
  // Core never depends on Commerce being installed to compute this; it's simply false when no
  // such profile exists (including on a deployment that's never had Commerce enabled at all).
  isCommerceCustomer: z.boolean(),
  // Self-set by the account owner on their own Profile page — purely informational contact info,
  // not used for 2FA/SMS or any security check.
  phone: z.string().nullable(),
  // Staff-only context about this account (never readable/writable by the account owner
  // themselves) — set through PATCH .../users/:id/notes, shown on the User detail screen.
  internalNotes: z.string().nullable(),
  createdAt: z.string(),
  lastActiveAt: z.string().nullable(),
});

export const updateUserRoleSchema = z.object({
  // 'none' revokes CMS access without deleting the account (it stays a normal website user).
  role: z.enum(ACCOUNT_ROLES),
});

export const updateUserDisabledSchema = z.object({
  disabled: z.boolean(),
});

export const updateUserDeveloperToolsAccessSchema = z.object({
  developerToolsAccess: z.boolean(),
});

// Staff-only context about an account — a support ticket reference, why an account was
// disabled, etc. Explicit null clears it; omitted is rejected by the route (nothing to update).
export const updateUserInternalNotesSchema = z.object({
  internalNotes: z.string().max(5000).nullable(),
});

export const elevateSchema = z.object({
  password: z.string().min(1),
});

export const transferOwnershipSchema = z.object({
  targetUserId: z.string().min(1),
});

export const createUserSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
});

// A one-time temporary password, not the user's own choice — shown to the owner once so they
// can share it with the new user directly (still delivered by email too, alongside a separate
// verification email the new user must click before they can sign in at all — see
// apps/api/src/lib/auth.ts's emailVerification config). better-auth's own change-password flow
// (already used by ProfilePage) is how the user replaces it after verifying.
export const createdUserSchema = z.object({
  user: adminUserSchema,
  temporaryPassword: z.string(),
});

// A user's own admin session — better-auth's session table has more columns (id, token,
// expiresAt, ...) than are useful to show; this is deliberately just the ones a "who's signed
// in, from where, since when" admin view needs. Never includes the session token itself.
export const sessionSchema = z.object({
  id: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string(),
});

export type AdminUser = z.infer<typeof adminUserSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
export type UpdateUserDisabledInput = z.infer<typeof updateUserDisabledSchema>;
export type UpdateUserDeveloperToolsAccessInput = z.infer<typeof updateUserDeveloperToolsAccessSchema>;
export type UpdateUserInternalNotesInput = z.infer<typeof updateUserInternalNotesSchema>;
export type ElevateInput = z.infer<typeof elevateSchema>;
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type CreatedUser = z.infer<typeof createdUserSchema>;
export type Session = z.infer<typeof sessionSchema>;
