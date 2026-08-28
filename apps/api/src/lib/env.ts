export interface Bindings {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  FORM_SUBMISSION_RATE_LIMITER: RateLimit;
  AUTH_RATE_LIMITER: RateLimit;
  API_VERSION: string;
  CORS_ORIGINS: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}
