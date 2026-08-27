import { z } from 'zod';

export const USER_ROLES = ['owner', 'editor'] as const;

export type UserRole = (typeof USER_ROLES)[number];

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

export type AdminUser = z.infer<typeof adminUserSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
