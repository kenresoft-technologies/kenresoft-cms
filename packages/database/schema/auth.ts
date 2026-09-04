import { relations, sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text("role").default("editor").notNull(),
  disabled: integer("disabled", { mode: "boolean" }).default(false).notNull(),
  // Whether this user can see the Developer panel (apps/admin/src/lib/developer-mode.ts) when
  // the deployment-wide Developer Mode flag is also on. Owner/admin always qualify regardless
  // of this column (they're the ones who can turn the flag on in the first place); for
  // editor/author it's an explicit per-user grant rather than automatic from role, so an admin
  // can hand developer tooling to the one technical author on a team without exposing it to
  // every author by default.
  developerToolsAccess: integer("developer_tools_access", { mode: "boolean" }).default(false).notNull(),
  // Managed entirely by better-auth's own two-factor plugin schema (apps/api/src/lib/
  // auth-options.ts) — column name/shape here must match what that plugin expects verbatim,
  // not a field this app's own code ever writes directly.
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).default(false).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    elevatedUntil: integer("elevated_until", { mode: "timestamp_ms" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    // better-auth 1.7 scopes account identity by issuer, not just providerId — required with no
    // app-level default value that varies per row, since this project only ever creates
    // credential (email/password) accounts, never social/OAuth/SIWE: every account, past and
    // future, gets the same deterministic namespace per better-auth's own 1.7 upgrade guide
    // (https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-is-scoped-by-issuer).
    issuer: text("issuer").notNull().default("local:credential"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("account_userId_idx").on(table.userId),
    // Required by better-auth 1.7 (see the issuer column's own comment above) — account
    // identity is now the (issuer, accountId) pair, not accountId alone.
    uniqueIndex("account_issuer_accountId_idx").on(table.issuer, table.accountId),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// better-auth's two-factor plugin's own table (schema shape fixed by that plugin, not this
// app's design) — id/userId/secret/backupCodes, secret and backupCodes stored exactly as the
// plugin writes them (backupCodes is a plugin-managed encoded string, never parsed here).
export const twoFactor = sqliteTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Added by better-auth 1.7's two-factor plugin (not present when this table was first
    // generated against the 1.4.x line — @better-auth/cli's schema generator still bundles its
    // own internal 1.4.x copy, so this drift was never caught at generate time; see auth.ts's
    // own comment on the exact-pinned `better-auth` version for the same class of gap already
    // hit once with account.issuer). Confirmed against the installed package's own
    // dist/plugins/two-factor/schema.mjs rather than guessed: verified defaults true (an
    // enrollment created with skipVerificationOnEnable, which this app doesn't use, would start
    // unverified — this app's two-step enable() -> verifyTotp() flow only ever creates a row
    // once already confirmed); failedVerificationCount/lockedUntil back a brute-force lockout on
    // verifyTotp() this app's UI doesn't surface explicitly but the plugin enforces regardless.
    verified: integer("verified", { mode: "boolean" }).default(true).notNull(),
    failedVerificationCount: integer("failed_verification_count").default(0).notNull(),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
  },
  (table) => [index("two_factor_userId_idx").on(table.userId), index("two_factor_secret_idx").on(table.secret)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  twoFactor: many(twoFactor),
}));

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  user: one(user, {
    fields: [twoFactor.userId],
    references: [user.id],
  }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
