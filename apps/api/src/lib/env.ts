export interface Bindings {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  FORM_SUBMISSION_RATE_LIMITER: RateLimit;
  AUTH_RATE_LIMITER: RateLimit;
  RECOVERY_RATE_LIMITER: RateLimit;
  API_VERSION: string;
  CORS_ORIGINS: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  // Password-reset / recovery-code emails (apps/api/src/lib/email). Unset or unrecognized
  // EMAIL_PROVIDER falls back to a noop sender that logs instead of failing, so pnpm dev keeps
  // working with zero email setup — see docs/ARCHITECTURE.md's recovery section.
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  // Where the reset-password link in a password-reset email points — the admin SPA's deployed
  // origin. Falls back to the first CORS_ORIGINS entry (fine for local dev, where that's the
  // Vite dev server) when unset, so a fork doesn't have to set yet another var just to try the
  // flow locally.
  ADMIN_URL?: string;
  // Cloudflare Email Service — only needed when EMAIL_PROVIDER=cloudflare. Absent from
  // wrangler.toml by default (an unconfigured [[send_email]] binding would be dead
  // provisioning); add it there and run `wrangler email sending enable` to use this provider.
  EMAIL?: SendEmail;
  // Resend — only needed when EMAIL_PROVIDER=resend.
  RESEND_API_KEY?: string;
  // The break-glass owner-recovery endpoint (POST /api/v1/system/recover-owner) 404s outright
  // when this is unset — zero attack surface for any deployment that hasn't explicitly opted
  // in via `wrangler secret put OWNER_RECOVERY_SECRET`. Never given a default value here or in
  // wrangler.toml; an operator who wants this recovery path enables it deliberately.
  OWNER_RECOVERY_SECRET?: string;
}
