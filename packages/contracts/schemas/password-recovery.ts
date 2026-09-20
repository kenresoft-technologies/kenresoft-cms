import { z } from 'zod';

// Shared by both self-service recovery paths (password-reset confirm, recovery-code redeem) —
// kept in one place so the minimum-length policy can't drift between them.
const newPasswordSchema = z.string().min(8).max(200);

export const requestPasswordResetSchema = z.object({
  email: z.string().email(),
  // Website users (no CMS access — e.g. storefront customers) reset their password on their OWN
  // site, not the admin SPA: the emailed link is `<redirectUrl>?token=...`. Only honored when its
  // origin is in this deployment's CORS_ORIGINS allow-list, and never for CMS staff (who always
  // get the admin link) — the client never gets to point a staff reset email anywhere.
  redirectUrl: z.string().url().optional(),
});

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1),
  newPassword: newPasswordSchema,
});

export const redeemRecoveryCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().min(1),
  newPassword: newPasswordSchema,
});

export const recoveryCodesGeneratedSchema = z.object({
  codes: z.array(z.string()),
});

export const recoveryCodesStatusSchema = z.object({
  remaining: z.number(),
});

export const genericMessageSchema = z.object({
  message: z.string(),
});

export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;
export type RedeemRecoveryCodeInput = z.infer<typeof redeemRecoveryCodeSchema>;
export type RecoveryCodesGenerated = z.infer<typeof recoveryCodesGeneratedSchema>;
export type RecoveryCodesStatus = z.infer<typeof recoveryCodesStatusSchema>;
