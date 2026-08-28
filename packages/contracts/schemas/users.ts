import { z } from 'zod';

import { USER_ROLES } from './enums';

export const adminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(USER_ROLES),
  createdAt: z.string(),
  lastActiveAt: z.string().nullable(),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(USER_ROLES),
});

export const createUserSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
});

// A one-time temporary password, not the user's own choice — there's no email sending
// configured (§9/ASTRO.md's "known limitations"), so an invite can't land as a magic link.
// The owner is shown this once and shares it with the new user directly; better-auth's own
// change-password flow (already used by ProfilePage) is how the user replaces it.
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
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type CreatedUser = z.infer<typeof createdUserSchema>;
export type Session = z.infer<typeof sessionSchema>;
