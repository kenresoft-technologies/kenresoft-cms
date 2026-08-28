import { z } from 'zod';

export const globalVariableSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const keySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Key must start with a letter and contain only letters, numbers, and underscores');

export const createGlobalVariableSchema = z.object({
  key: keySchema,
  value: z.string().max(10000),
});

export const updateGlobalVariableSchema = z.object({
  value: z.string().max(10000),
});

export type GlobalVariable = z.infer<typeof globalVariableSchema>;
export type CreateGlobalVariableInput = z.infer<typeof createGlobalVariableSchema>;
export type UpdateGlobalVariableInput = z.infer<typeof updateGlobalVariableSchema>;
