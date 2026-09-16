import { z } from 'zod';

import { slugSchema } from './common';

const notificationEmailsSchema = z.array(z.string().email()).max(10).nullable();

export const formSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  notificationEmails: notificationEmailsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createFormSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
  notificationEmails: notificationEmailsSchema.optional(),
});

// Hand-written, not createFormSchema.partial() — no field here has a .default(), so .partial()
// would actually be safe today, but every other update-schema in this codebase (see
// docs/SITE_BUILDER.md's "Phase 10 hardening pass" changelog entry) was burned by that pattern
// once a base schema gained a defaulted field, so new update schemas are written by hand from
// the start rather than relying on that staying true forever.
export const updateFormSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: slugSchema.optional(),
  notificationEmails: notificationEmailsSchema.optional(),
});

export type Form = z.infer<typeof formSchema>;
export type CreateFormInput = z.infer<typeof createFormSchema>;
export type UpdateFormInput = z.infer<typeof updateFormSchema>;
