// The one static, deterministic source of truth for which plugins are enabled in this
// deployment — known at build/deploy time, never database-driven (docs/PLUGINS.md). Disabling a
// plugin here takes its routes/admin UI/hooks dark; it never deletes that plugin's own data.
export const pluginsConfig = {
  hello: { enabled: true },
} as const satisfies Record<string, { enabled: boolean }>;
