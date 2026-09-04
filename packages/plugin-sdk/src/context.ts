import type { Database } from '@kenresoft-cms/database';
import type { UserRole } from '@kenresoft-cms/contracts/schemas/enums';

// The exact bindings/session shape a plugin route actually needs — a deliberate subset of
// apps/api's own Bindings/AuthedVariables (apps/api/src/lib/env.ts,
// apps/api/src/middleware/require-session.ts), not a re-export of them: a plugin package must
// never depend on an app's src/, only the reverse (docs/PLUGINS.md).
export interface PluginBindings {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
}

export interface PluginSessionUser {
  id: string;
  email: string;
  role: UserRole;
  disabled: boolean;
}

export interface PluginMediaSummary {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
}

// Wraps Core's existing media system (apps/api/src/lib/media-service.ts) — a plugin never
// touches R2 or the media table directly. There's no `contentType` input: Core sniffs the
// actual bytes to decide it, the same "never trust a declared MIME type" rule the admin upload
// route already enforces (docs/ARCHITECTURE.md §9/§14) — a caller-supplied value would be
// silently ignored, so the field isn't offered at all.
export interface PluginMediaService {
  get(id: string): Promise<PluginMediaSummary | null>;
  upload(input: { bytes: Uint8Array; filename: string }): Promise<PluginMediaSummary>;
  delete(id: string): Promise<boolean>;
}

// Generic, validated, non-secret plugin configuration (packages/database/schema/plugin-
// settings.ts) — T is the plugin's own config shape, validated against its own
// PluginRegistration.configSchema before being handed back. Never store secrets through this —
// see docs/PLUGINS.md.
export interface PluginConfigService<T = unknown> {
  get(): Promise<T>;
  set(value: T): Promise<void>;
}

// In-process, best-effort, synchronous only — not a durable queue. A handler runs synchronously
// within the same request that called emit(); there is no persistence, no retry, and no
// cross-request delivery guarantee. No critical business state transition may depend solely on
// a handler firing here — see docs/PLUGINS.md and the existing apps/api/src/lib/webhooks.ts
// (DB-backed, retried on the Cron Trigger) for the durable-delivery answer when one is needed.
export interface PluginEventBus {
  emit(event: string, payload: unknown): void;
  on(event: string, handler: (payload: unknown) => void): () => void;
}

export interface PluginLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// The one object a plugin's route handlers ever receive to reach Core. `db` is deliberately
// typed as the same singular Database type Core's own repositories use (docs/PLUGINS.md's SDK
// boundary note) — a plugin repository file may only query its own `plugin_<id>_*` tables, a
// convention enforced by review/docs, not the type system, in Phase 1. This is named as its own
// interface (not a bare re-export of Database) specifically so a future version can narrow it
// into a per-plugin scoped query interface without changing PluginRegistration's shape.
export interface PluginContext {
  pluginId: string;
  db: Database;
  user: PluginSessionUser;
  hasRole(minimum: UserRole): boolean;
  media: PluginMediaService;
  config: PluginConfigService;
  events: PluginEventBus;
  logger: PluginLogger;
}

export interface PluginVariables {
  user: PluginSessionUser;
  session: { id: string };
  pluginContext: PluginContext;
}
