export interface Bindings {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  CACHE_KV: KVNamespace;
  FORM_SUBMISSION_RATE_LIMITER: RateLimit;
  API_VERSION: string;
  CORS_ORIGINS: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}
