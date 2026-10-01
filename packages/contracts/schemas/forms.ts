import { z } from 'zod';

import { slugSchema } from './common';

const notificationEmailsSchema = z.array(z.string().email()).max(10).nullable();

// Ordered, distinct, non-empty labels. The first is the stage a new submission starts in.
const stagesSchema = z
  .array(z.string().trim().min(1).max(60))
  .min(1)
  .max(12)
  .refine((stages) => new Set(stages).size === stages.length, 'Stages must be distinct')
  .nullable();

// Absolute http(s) only: it is the link in emails sent to the owning account. `{id}` is
// replaced with the submission id.
const accountSubmissionUrlSchema = z
  .string()
  .max(500)
  .regex(/^https?:\/\/\S+$/i, 'Must be an absolute http(s) URL')
  .nullable();

// Submission context: a form that is always "about" one published entry (a job application about
// an Opportunity, a booking about an Event). The visitor names the entry in the submit URL
// (?context=<slug>); the server resolves it, refuses anything that is not published, and stores
// the reference itself. `openWhen` and `deadlineField` optionally close the entry to new
// submissions: every `field` must equal its value in the entry's data, and a date in
// `deadlineField` that has passed also closes it. Field values are compared as strings or booleans.
export const formContextConfigSchema = z
  .object({
    contentType: slugSchema,
    openWhen: z
      .array(z.object({ field: z.string().trim().min(1).max(80), equals: z.union([z.string().max(200), z.boolean()]) }))
      .max(4)
      .optional(),
    deadlineField: z.string().trim().min(1).max(80).optional(),
  })
  .nullable();

export const formSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  notificationEmails: notificationEmailsSchema,
  requiresAccount: z.boolean(),
  stages: z.array(z.string()).nullable(),
  accountSubmissionUrl: z.string().nullable(),
  contextConfig: formContextConfigSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createFormSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
  notificationEmails: notificationEmailsSchema.optional(),
  requiresAccount: z.boolean().optional(),
  stages: stagesSchema.optional(),
  accountSubmissionUrl: accountSubmissionUrlSchema.optional(),
  contextConfig: formContextConfigSchema.optional(),
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
  requiresAccount: z.boolean().optional(),
  stages: stagesSchema.optional(),
  accountSubmissionUrl: accountSubmissionUrlSchema.optional(),
  contextConfig: formContextConfigSchema.optional(),
});

export type FormContextConfig = NonNullable<z.infer<typeof formContextConfigSchema>>;
export type Form = z.infer<typeof formSchema>;
export type CreateFormInput = z.infer<typeof createFormSchema>;
export type UpdateFormInput = z.infer<typeof updateFormSchema>;
