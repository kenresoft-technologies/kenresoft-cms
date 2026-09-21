import type {
  BlockInstance,
  ChildBlockInstance,
  ContactSettingsData,
  Entry,
  FooterSettingsData,
  FormSubmission,
  GeneralSettingsData,
  NavigationSettingsData,
  Page,
  PageListItem,
  PublicMedia,
  PublicMediaListItem,
  ReusableBlock,
  RoutePatternEntry,
  SeoSettingsData,
  SocialSettingsData,
} from '@kenresoft-cms/contracts';

import { createAuth, type KenresoftAuth } from './auth';
import { KenresoftApiError, type FormSubmissionIssue } from './errors';

export { KenresoftApiError, type FormSubmissionIssue };
export type {
  AuthMessage,
  AuthSession,
  AuthSessionData,
  AuthUser,
  ChangePasswordOptions,
  KenresoftAuth,
  RequestPasswordResetOptions,
  ResendVerificationEmailOptions,
  ResetPasswordOptions,
  SignInOptions,
  SignInResult,
  SignUpOptions,
  TwoFactorEnableResult,
  VerifyEmailOptions,
} from './auth';

export type { BlockInstance, ChildBlockInstance, Page, ReusableBlock };

// Type-only imports — erased at compile time, so this package never actually depends on zod
// (or anything else @kenresoft-cms/contracts pulls in) at runtime. They exist purely so this
// client's return types stay in sync with the API's real response shapes instead of a
// hand-maintained copy — see the "Types" note in docs/ASTRO.md.
export type { Entry, FormSubmission, PublicMedia, PublicMediaListItem, RoutePatternEntry };

// Phase 1 of the schema-driven frontend work (docs/SITE_BUILDER.md) — a read-only field
// renderer registry, independent of the request/response client below. Re-exported here so
// `import { renderField, registerFieldRenderer } from '@kenresoft-cms/astro'` works without a
// consumer needing to know about the internal `render/` module layout.
export {
  registerFieldRenderer,
  renderField,
  resolveFieldRenderer,
  type FieldRenderer,
  type FieldRenderResult,
  type RenderableField,
} from './render/field-renderers';

// Phase 2 of the schema-driven frontend work (docs/SITE_BUILDER.md) — dynamic content routing.
// `resolveRoute()`/`matchRoutePattern()` are pure functions, independent of the client below;
// pair them with `client.routePatterns.list()` to build a generic catch-all Astro route.
export {
  matchRoutePattern,
  resolveRoute,
  resolveSiteRoute,
  type ResolvedRoute,
  type ResolvedSiteRoute,
} from './render/resolve-route';

// Phase 7 of the schema-driven frontend work (docs/SITE_BUILDER.md §6) — the developer-override
// half of block rendering; see block-renderers.ts's own top comment for why the built-in
// default components live in examples/astro-site instead of here.
export { registerBlockRenderer, resolveBlockRenderer, type BlockComponent } from './render/block-renderers';

// Phase 6 of the schema-driven frontend work (docs/SITE_BUILDER.md §3.7) — resolves a
// Navigation item's `pageId` reference to that Page's own `route`, alongside its plain `url`
// items. Pair with `client.pages.list()` below.
export { resolveNavigationItems, type ResolvedNavigationItem } from './render/resolve-navigation';

export interface KenresoftClientConfig {
  /** Base URL of a Kenresoft CMS deployment, e.g. "http://localhost:8787" in local dev. */
  url: string;
  /** Override for testing — defaults to the global fetch. */
  fetch?: typeof fetch;
  /**
   * Binds this client instance to one request's Live Preview session — every
   * `entries.get()`/`pages.resolve()` call made through it automatically uses this as its
   * `previewToken`, with no need to pass it per call. The intended, global way to wire up Live
   * Preview: create one client per request (e.g. in Astro middleware, stored on
   * `context.locals`) with `previewToken: getPreviewToken(context.url)`, and every page that
   * reads from `context.locals` gets Live Preview for free — no page needs to know about
   * `?preview_token=` at all. A call's own explicit `previewToken` (including `null`, to force
   * published-only even when this default is set) still overrides this default when given.
   * See `getPreviewToken()` below and `integrations/astro/README.md`'s "Live Preview" section.
   */
  previewToken?: string | null;
  /**
   * The incoming request's `cookie` header, for server-side rendering: forwarded on every call
   * so `auth.getSession()` / `commerce.customer.get()` can tell who the visitor is during SSR
   * (e.g. `cookies: Astro.request.headers.get('cookie')`). Only useful when the site and API
   * share a cookie domain — on separate sites the browser never sends the API's cookie to your
   * site, so run the check in the browser instead. Ignored when a custom `fetch` is supplied
   * (you're then handling headers yourself).
   */
  cookies?: string | null;
}

export { getPreviewToken } from './get-preview-token';
export { createCmsProxy, isProxiedPathAllowed, type CmsProxyOptions } from './proxy';

// Commerce (packages/plugin-ecommerce) types, hand-mirrored from that plugin's own Zod route
// schemas rather than imported — unlike @kenresoft-cms/contracts, the plugin package isn't
// published to npm (it lives only inside the monorepo, per docs/PLUGINS.md's own package-
// boundary reasoning), so there's nothing to import from here. Keep these in sync by hand with
// packages/plugin-ecommerce/src/routes/{public,cart,checkout,payments}.ts whenever those change.
export interface CommerceCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
}

export interface CommerceProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  shortDescription: string | null;
  productType: 'physical' | 'digital' | 'service';
  basePrice: number;
  currency: string;
  categoryId: string | null;
}

export interface CommerceProductImage {
  id: string;
  mediaId: string;
  altText: string | null;
  sortOrder: number;
}

export interface CommerceProductVariant {
  id: string;
  name: string;
  sku: string | null;
  /** Null = use the parent product's own basePrice — resolve price the same way cart/order do. */
  price: number | null;
  compareAtPrice: number | null;
  stockQty: number;
  attributes: Record<string, string> | null;
}

export interface CommerceProductDetail extends CommerceProduct {
  images: CommerceProductImage[];
  variants: CommerceProductVariant[];
}

export interface CommerceCartItem {
  id: string;
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  currency: string;
  stockQty: number | null;
}

export interface CommerceCart {
  /** Null when the caller has no cart yet — nothing has been added, or it was just cleared. */
  id: string | null;
  currency: string | null;
  items: CommerceCartItem[];
}

export interface AddCommerceCartItemOptions {
  productId: string;
  variantId?: string | null;
  quantity?: number;
}

export interface UpdateCommerceCartItemOptions {
  itemId: string;
  quantity: number;
}

export interface RemoveCommerceCartItemOptions {
  itemId: string;
}

export interface CommerceShippingAddress {
  recipientName: string;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode: string;
  country: string;
  phone?: string | null;
}

export interface CommerceCheckoutOptions {
  /**
   * A caller-generated key (e.g. `crypto.randomUUID()`) unique per checkout ATTEMPT — reused
   * on retry (a lost response, a double-click) to safely replay the same order instead of
   * creating a second one; a genuinely new attempt (a fixed cart, a new session) needs a fresh
   * key. See packages/plugin-ecommerce/src/routes/checkout.ts's own Idempotency-Key handling.
   */
  idempotencyKey: string;
  /** Required for a guest checkout; a signed-in customer's own profile supplies it by default. */
  email?: string;
  name?: string;
  shippingAddress: CommerceShippingAddress;
}

export interface CommerceOrderItem {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string | null;
  unitPriceAtPurchase: number;
  quantity: number;
}

export interface CommerceOrder {
  id: string;
  status: 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';
  currency: string;
  totalAmount: number;
  customerEmail: string;
  customerName: string;
  createdAt: string;
  items: CommerceOrderItem[];
}

export interface InitializeCommercePaymentOptions {
  orderId: string;
  /**
   * Where Paystack redirects the browser after payment — must match one of this deployment's
   * own configured CORS origins (packages/plugin-ecommerce/src/routes/payments.ts rejects
   * anything else, closing off an open-redirect-adjacent primitive).
   */
  callbackUrl: string;
}

export interface CommercePaymentSession {
  /** Redirect the browser here to reach Paystack's hosted checkout page. */
  authorizationUrl: string;
  reference: string;
}

export interface VerifyCommercePaymentOptions {
  orderId: string;
  /** The `reference` a prior `payments.initialize()` call returned for this same order. */
  reference: string;
}

export interface CommercePaymentStatus {
  orderStatus: CommerceOrder['status'];
  paid: boolean;
}

export interface CommerceCustomer {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  emailVerified: boolean;
}

export interface RegisterCustomerOptions {
  email: string;
  password: string;
  name: string;
  /**
   * Where the emailed verification link sends the customer once verified (their own site, e.g.
   * `${origin}/account/verify-email`). Must be an origin in the deployment's CORS_ORIGINS.
   */
  callbackUrl?: string;
}

export interface LoginCustomerOptions {
  email: string;
  password: string;
}

export interface RequestCustomerPasswordResetOptions {
  email: string;
  /**
   * The customer's own reset page; the emailed link becomes `<redirectUrl>?token=...`. Must be an
   * origin in the deployment's CORS_ORIGINS, otherwise the email falls back to the admin app's page.
   */
  redirectUrl?: string;
}

export interface ConfirmCustomerPasswordResetOptions {
  token: string;
  newPassword: string;
}

export interface VerifyCustomerEmailOptions {
  token: string;
}

export interface ResendCustomerVerificationEmailOptions {
  email: string;
  /** Same meaning as RegisterCustomerOptions.callbackUrl. */
  callbackUrl?: string;
}

export interface UpdateCustomerProfileOptions {
  name?: string;
  phone?: string | null;
}

export interface ChangeCustomerPasswordOptions {
  currentPassword: string;
  newPassword: string;
}

export interface CommerceCustomerAddress {
  id: string;
  label: string | null;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

export interface WritableCustomerAddress {
  label?: string | null;
  recipientName: string;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode: string;
  country: string;
  phone?: string | null;
  isDefault?: boolean;
}

export interface CommerceOrderSummary {
  id: string;
  status: CommerceOrder['status'];
  currency: string;
  totalAmount: number;
  createdAt: string;
}

export interface CommerceOrderDetail extends CommerceOrderSummary {
  items: CommerceOrderItem[];
}

export interface ListEntriesOptions {
  /** The content type's slug (not its display name) — e.g. "blog-post". */
  contentType: string;
}

export interface GetEntryOptions extends ListEntriesOptions {
  /** The entry's own slug within that content type. */
  slug: string;
  /**
   * Optional. Pass a Live Preview token straight through — e.g. `getPreviewToken(Astro.url)` —
   * and this call transparently renders a draft (or any status) via the same signed-token
   * mechanism `entries.preview()` uses, with no separate branch needed in your own template.
   * Omitting this option entirely falls back to the client's own `previewToken` default (see
   * `KenresoftClientConfig.previewToken`), if one was set when the client was created — the
   * global, per-page-code-free way to wire this up. Pass `null` explicitly to force normal
   * published-only rendering even when the client has a default set.
   */
  previewToken?: string | null;
}

export interface PreviewEntryOptions extends GetEntryOptions {
  /**
   * A signed, entry-scoped token from `GET /api/v1/admin/entries/:id/preview-token` (Kenresoft
   * CMS's Entry Editor generates one and appends it to the preview link it opens) — an
   * expired/invalid/wrong-entry token 404s (`null`) exactly like a nonexistent slug does through
   * `entries.get()`. Never the normal path for rendering published content.
   */
  token: string;
}

export interface MediaUrlOptions {
  /** A Media item's id — typically the value stored in a `media`-type field on an Entry. */
  id: string;
}

export interface MediaFolderOptions {
  /** A media folder's slug (e.g. "home-page-hero"), not its id or display name. */
  slug: string;
}

export interface ResolvePageOptions {
  /** The Page's literal route, e.g. "/about" — not a `{slug}` pattern. */
  route: string;
  /**
   * Optional. Same convention as `GetEntryOptions.previewToken` above — pass a token to
   * transparently render a draft (or any status) Page, omit to fall back to the client's own
   * `previewToken` default, or pass `null` to force published-only regardless of that default.
   */
  previewToken?: string | null;
}

export interface PreviewPageOptions extends ResolvePageOptions {
  /**
   * A signed, page-scoped token from `GET /api/v1/admin/pages/:id/preview-token` (Kenresoft
   * CMS's Page Editor's "Live Preview" button generates one and appends it to the link it
   * opens) — an expired/invalid/wrong-page token 404s (`null`) exactly like a nonexistent
   * route does through `pages.resolve()`. Never the normal path for rendering published Pages.
   */
  token: string;
}

export interface GetReusableBlockOptions {
  /** A reusable block's own id — typically a `config.reusableBlockId` on a `reusableBlockRef` block. */
  id: string;
}

export interface SubmitFormOptions {
  /** The form's slug, not its display name — e.g. "contact". */
  formSlug: string;
  /**
   * Field values keyed by each field's name. No fixed shape — validated server-side against
   * that form's own field definitions (there's no client-side equivalent of those definitions
   * to validate against here, since there's no public form-metadata endpoint either).
   */
  data: Record<string, unknown>;
}

export interface KenresoftClient {
  /**
   * Generic frontend authentication against Core's own better-auth (`/api/v1/auth/*`) and
   * password-reset routes — sign up/in/out, session, email verification, password reset/change,
   * and two-factor. Independent of Commerce or any plugin; `commerce.customerAuth` below is a
   * thin adapter over this same object. Browser-side use is the norm: the session cookie must
   * land in the visitor's own cookie jar. See the package README's "Authentication" section.
   */
  auth: KenresoftAuth;
  entries: {
    /**
     * Every published entry for a content type, newest-published-first is NOT guaranteed —
     * matches whatever order GET /api/v1/public/:contentType returns (see apps/api/src/
     * repositories/entries.ts). Returns an empty array for a content type with no published
     * entries, and also for a content type slug that doesn't exist at all — the public API
     * doesn't distinguish those two cases (a content type is only ever addressed by slug
     * here, never listed/discovered — there is no public content-type-metadata endpoint).
     */
    list(options: ListEntriesOptions): Promise<Entry[]>;
    /**
     * A single published entry by slug, or null if there's no content type with that slug,
     * or no *published* entry with that slug — including when a draft entry with that exact
     * slug exists (docs/ARCHITECTURE.md §6/§14: a draft 404s exactly like a slug that doesn't
     * exist, from the public API's perspective). Pass `options.previewToken` to render a draft
     * instead — see `GetEntryOptions.previewToken`; equivalent to calling `preview()` below but
     * without a separate branch in your own template.
     */
    get(options: GetEntryOptions): Promise<Entry | null>;
    /**
     * Fetches one entry regardless of draft/published status, given a valid preview token for
     * it — see `PreviewEntryOptions.token`. Powers Live Preview; equivalent to
     * `get({ ...options, previewToken: options.token })` — kept as its own method for callers
     * that always have a token in hand and want that explicit in their own code.
     */
    preview(options: PreviewEntryOptions): Promise<Entry | null>;
  };
  media: {
    /**
     * The public URL for a media item's file bytes — URL construction only, no fetch (an
     * `<img src>` or similar consumes it directly). Doesn't validate that the id exists; a
     * bad id 404s when the browser requests it, same as a broken image link anywhere else.
     */
    url(options: MediaUrlOptions): string;
    /**
     * Alt text, content type, and pixel dimensions for a media item — everything an `<img>`
     * needs beyond the src from `url()` above (a real `alt`, and `width`/`height` to reserve
     * layout space before the file loads). Returns null if no media exists with that id.
     */
    get(options: MediaUrlOptions): Promise<PublicMedia | null>;
    /**
     * Every item in a named media folder (e.g. "home-page-hero") — lets a frontend fetch a
     * deliberately-curated collection instead of guessing at ids from the flat library. Returns
     * an empty array for a folder slug that doesn't exist (folders have no draft/published
     * distinction to hide, so this is just "no items", not a 404 worth throwing over).
     */
    byFolder(options: MediaFolderOptions): Promise<PublicMediaListItem[]>;
  };
  forms: {
    /**
     * Submits a public form. Rate limited server-side (5/60s per client IP) and validated
     * against the form's own field definitions — throws KenresoftApiError with `issues`
     * populated for a validation failure (400), and without `issues` for a nonexistent form
     * (404) or exceeding the rate limit (429).
     */
    submit(options: SubmitFormOptions): Promise<FormSubmission>;
  };
  globalVariables: {
    /**
     * Every global variable as a flat key/value map — matches
     * GET /api/v1/public/global-variables exactly (edge-cached, same as entries/media). An
     * empty object if none have been created, never null; there's no per-key sub-resource to
     * 404 on, unlike entries/media.
     */
    list(): Promise<Record<string, string>>;
  };
  /**
   * Phase 2 of the schema-driven frontend work (docs/SITE_BUILDER.md) — deliberately narrow:
   * {contentTypeSlug, routePattern} pairs only, never field definitions (see
   * routes/public/route-patterns.ts's own doc comment on why this is NOT the still-unresolved
   * "public content-type metadata" question). Feeds `resolveRoute()` below.
   */
  routePatterns: {
    /** Matches GET /api/v1/public/route-patterns exactly (edge-cached). An empty array if no content type has a routePattern set. */
    list(): Promise<RoutePatternEntry[]>;
  };
  /**
   * `list()` is deliberately narrow, like routePatterns above — id/route/title only, never the
   * full block tree; feeds `resolveNavigationItems()` above and sitemap-style generation.
   * `resolve()`/`preview()` fetch one Page fully, for actual rendering (Phase 7 — see
   * `resolveSiteRoute()`/`<PageRenderer>` in `examples/astro-site`).
   */
  pages: {
    /** Matches GET /api/v1/public/pages exactly (edge-cached). Only published pages. */
    list(): Promise<PageListItem[]>;
    /**
     * A published Page by its exact route, or null if there's no Page there, or the Page at
     * that route is a draft — a draft 404s exactly like a nonexistent route (§7, mirroring
     * entries). Pass `options.previewToken` to render a draft instead — see
     * `ResolvePageOptions.previewToken`.
     */
    resolve(options: ResolvePageOptions): Promise<Page | null>;
    /**
     * Fetches one Page regardless of draft/published status, given a valid preview token for
     * it — see `PreviewPageOptions.token`. Powers Page Live Preview; equivalent to
     * `resolve({ ...options, previewToken: options.token })`.
     */
    preview(options: PreviewPageOptions): Promise<Page | null>;
  };
  reusableBlocks: {
    /**
     * A reusable block's own type/config by id, resolved live (never cached beyond the normal
     * edge TTL) since it's a *live reference* (§3.4) — editing it changes what every page
     * embedding it renders next time. Returns null for an unknown id.
     */
    get(options: GetReusableBlockOptions): Promise<ReusableBlock | null>;
  };
  /**
   * Structured Settings (docs/ARCHITECTURE.md §6) — singleton, typed, schema-validated site
   * configuration, distinct from the free-form `globalVariables` above. Each method matches
   * `GET /api/v1/public/settings/:module` exactly (edge-cached the same way) and resolves an
   * empty object `{}` — never null — for a module that's never been saved in the admin, so a
   * consumer can always destructure straight into its own defaults.
   */
  settings: {
    general(): Promise<GeneralSettingsData | Record<string, never>>;
    contact(): Promise<ContactSettingsData | Record<string, never>>;
    social(): Promise<SocialSettingsData | Record<string, never>>;
    navigation(): Promise<NavigationSettingsData | Record<string, never>>;
    footer(): Promise<FooterSettingsData | Record<string, never>>;
    seo(): Promise<SeoSettingsData | Record<string, never>>;
  };
  /**
   * The Commerce plugin's storefront surface (packages/plugin-ecommerce) — catalog, cart,
   * checkout, and Paystack payment confirmation. Only present/meaningful on a deployment that
   * has the commerce plugin installed and enabled; calling these against one that doesn't will
   * 404 the same way any disabled-plugin route does (docs/PLUGINS.md's enablement section).
   * Guest checkout and signed-in customers are both supported: a guest cart travels as a cookie,
   * a customer is a Core account (see `auth` above and `customerAuth` below).
   */
  commerce: {
    /**
     * Customer account registration/login/logout/password-reset/email-verification. There is ONE
     * identity system: these are thin wrappers over Core's own /api/v1/auth/* (better-auth) and
     * /api/v1/public/password-reset/* routes — the very same accounts and sessions CMS staff use.
     * A customer is simply an account with no CMS role, so signing up here can never confer CMS
     * access, and the session cookie is the same one `commerce.customer`/cart/checkout read.
     */
    customerAuth: {
      /**
       * Creates an account (no CMS access) and emails a verification link. The customer is NOT
       * signed in until they verify their email, so this resolves without a session. Registering an
       * already-registered email resolves identically (never reveals whether an account exists).
       */
      register(options: RegisterCustomerOptions): Promise<{ requiresEmailVerification: true }>;
      /** Throws KenresoftApiError (401) for invalid credentials; (403) if the email isn't verified yet (a fresh verification email is sent). Resolves with the signed-in customer's profile. */
      login(options: LoginCustomerOptions): Promise<CommerceCustomer>;
      /** Idempotent — safe to call with no session. */
      logout(): Promise<void>;
      /** Always resolves with the same generic message regardless of whether the email matches an account — never reveals account existence. */
      requestPasswordReset(options: RequestCustomerPasswordResetOptions): Promise<{ message: string }>;
      /** Throws KenresoftApiError (400) for an invalid/expired token. */
      confirmPasswordReset(options: ConfirmCustomerPasswordResetOptions): Promise<{ message: string }>;
      /** For a site that builds its own verification link; throws KenresoftApiError for an invalid/expired token. (The default emailed link verifies server-side and redirects to `callbackUrl`.) */
      verifyEmail(options: VerifyCustomerEmailOptions): Promise<{ message: string }>;
      /** Always resolves with the same generic message regardless of whether the email matches an account or is already verified — never reveals either. */
      resendVerificationEmail(options: ResendCustomerVerificationEmailOptions): Promise<{ message: string }>;
      /**
       * Finishes a `login()` that rejected with `code: 'TWO_FACTOR_REQUIRED'`: verifies the
       * authenticator (or single-use backup) code through `auth.twoFactor`, then resolves the
       * signed-in customer's profile.
       */
      verifyTwoFactor(options: { code: string; method?: 'totp' | 'backup-code'; trustDevice?: boolean }): Promise<CommerceCustomer>;
    };
    /**
     * The signed-in customer's own profile/addresses/order-history — every method throws
     * KenresoftApiError (401) with no valid customer session.
     */
    customer: {
      /** The current customer, or null with no valid session (never throws for that specific case). */
      get(): Promise<CommerceCustomer | null>;
      update(options: UpdateCustomerProfileOptions): Promise<CommerceCustomer>;
      /** Core's better-auth change-password. Throws KenresoftApiError for an incorrect currentPassword. Revokes every other session. */
      changePassword(options: ChangeCustomerPasswordOptions): Promise<{ message: string }>;
      addresses: {
        list(): Promise<CommerceCustomerAddress[]>;
        create(options: WritableCustomerAddress): Promise<CommerceCustomerAddress>;
        update(id: string, options: Partial<WritableCustomerAddress>): Promise<CommerceCustomerAddress>;
        /** Throws KenresoftApiError (404) if that id isn't one of the caller's own addresses. */
        remove(id: string): Promise<void>;
      };
      orders: {
        /** Newest first. */
        list(): Promise<CommerceOrderSummary[]>;
        /** Throws KenresoftApiError (404) if that id doesn't belong to the caller — identical to a nonexistent id, never distinguishable. */
        get(id: string): Promise<CommerceOrderDetail>;
      };
    };
    categories: {
      /** Every active category. */
      list(): Promise<CommerceCategory[]>;
    };
    products: {
      /** Every published product, optionally scoped to one category. No images/variants — see `products.get()`. */
      list(options?: { categoryId?: string }): Promise<CommerceProduct[]>;
      /**
       * One published product by slug, with its images and active variants — or null if there's
       * no published product with that slug (including an unpublished/draft one, indistinguishable
       * from a nonexistent slug, matching entries.get()'s own convention).
       */
      get(options: { slug: string }): Promise<CommerceProductDetail | null>;
    };
    cart: {
      /** The caller's current cart (a guest cookie or a customer session, once accounts are wired in) — creates nothing. */
      get(): Promise<CommerceCart>;
      /** Adds an item, creating the cart on first use. Throws KenresoftApiError (400) for an unpublished product, an archived/out-of-stock variant, or a currency mismatch with the cart's existing items. */
      addItem(options: AddCommerceCartItemOptions): Promise<CommerceCart>;
      /** Throws KenresoftApiError (404) if that item isn't in the caller's own cart. */
      updateItem(options: UpdateCommerceCartItemOptions): Promise<CommerceCart>;
      /** Throws KenresoftApiError (404) if that item isn't in the caller's own cart. */
      removeItem(options: RemoveCommerceCartItemOptions): Promise<CommerceCart>;
      /** Clears every item — safe to call on an already-empty or nonexistent cart. */
      clear(): Promise<void>;
    };
    checkout: {
      /**
       * Converts the caller's own cart into a durable Order — real, atomic stock enforcement
       * happens here, not at add-to-cart time. Throws KenresoftApiError (400) for an empty cart,
       * a missing email/name on a guest checkout, an item no longer available, or insufficient
       * stock; (409) if a request with this exact idempotencyKey is already being processed —
       * retry shortly with the SAME key, not a new one.
       */
      submit(options: CommerceCheckoutOptions): Promise<CommerceOrder>;
    };
    payments: {
      /**
       * Starts a Paystack transaction for a `pending` order and returns where to redirect the
       * browser. Idempotent — a repeated call for the same order reuses an already-open attempt
       * rather than starting a second, duplicate one. Throws KenresoftApiError: 400 (an invalid
       * callbackUrl, or the order isn't payable), 404 (no such order), 409 (a prior attempt
       * already succeeded, for a different amount/currency than expected — needs manual
       * investigation, not a retry), 502 (the provider itself errored), 503 (payments aren't
       * configured on this deployment).
       */
      initialize(options: InitializeCommercePaymentOptions): Promise<CommercePaymentSession>;
      /**
       * Server-side verifies a payment reference and returns the order's current, authoritative
       * status — call this from the page `callbackUrl` points at, after Paystack redirects the
       * browser back. Never trust the redirect itself as proof of payment; this is what actually
       * confirms it. Throws KenresoftApiError: 400 (the reference doesn't belong to this order),
       * 404 (no such order), 409 (the provider confirmed payment for a mismatched amount/
       * currency), 502 (the provider itself errored), 503 (payments aren't configured).
       */
      verify(options: VerifyCommercePaymentOptions): Promise<CommercePaymentStatus>;
    };
  };
}

export function createKenresoftClient(config: KenresoftClientConfig): KenresoftClient {
  const baseUrl = config.url.replace(/\/$/, '');
  const cookieHeader = config.cookies;
  const doFetch: typeof fetch =
    config.fetch ??
    (cookieHeader
      ? (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set('cookie', cookieHeader);
          return fetch(input, { ...init, headers });
        }
      : fetch);
  const commerceBase = `${baseUrl}/api/plugins/commerce/public/v1`;
  const defaultPreviewToken = config.previewToken ?? null;

  // `credentials: 'include'` is required on every commerce call — cart identity (a guest cookie)
  // and, once accounts are wired in, a customer session, both travel as cookies that the API's
  // own CORS config must explicitly allow this storefront's origin to send/receive
  // (docs/PLUGINS.md's Commerce section: `CORS_ORIGINS` on the deployment). Catalog reads
  // (categories/products) don't strictly need this — no cookie identity involved — but including
  // it there too is harmless and keeps every commerce call uniform.
  async function commerceRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await doFetch(`${commerceBase}${path}`, {
      credentials: 'include',
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new KenresoftApiError(
        response.status,
        body?.error ?? `Kenresoft CMS API request failed: ${init?.method ?? 'GET'} ${path} -> ${response.status}`,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  // ONE auth implementation: the generic `auth` API. Commerce's customerAuth/changePassword
  // below delegate to it rather than carrying their own copy of these Core calls.
  const auth = createAuth(baseUrl, doFetch);

  async function currentCustomer(): Promise<CommerceCustomer | null> {
    const response = await doFetch(`${commerceBase}/customer`, { credentials: 'include' });
    if (response.status === 401) return null;
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new KenresoftApiError(response.status, body?.error ?? `Kenresoft CMS API request failed: GET /customer -> ${response.status}`);
    }
    return (await response.json()) as CommerceCustomer;
  }

  // Mirrors request()'s own "404 -> null" convention below, for the one commerce read that has
  // the same "addressed by slug, a draft/nonexistent slug both 404 identically" shape as
  // entries.get() — products.list()/categories.list() have no such per-item 404 to translate.
  async function commerceRequestOrNull<T>(path: string): Promise<T | null> {
    const response = await doFetch(`${commerceBase}${path}`, { credentials: 'include' });
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new KenresoftApiError(response.status, body?.error ?? `Kenresoft CMS API request failed: GET ${path} -> ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async function request<T>(path: string): Promise<T | null> {
    const response = await doFetch(`${baseUrl}${path}`);

    if (response.status === 404) return null;

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new KenresoftApiError(
        response.status,
        body?.error ?? `Kenresoft CMS API request failed: GET ${path} -> ${response.status}`,
      );
    }

    return (await response.json()) as T;
  }

  return {
    auth,
    entries: {
      async list({ contentType }) {
        const entries = await request<Entry[]>(`/api/v1/public/${contentType}`);
        return entries ?? [];
      },
      get({ contentType, slug, previewToken }) {
        const token = previewToken !== undefined ? previewToken : defaultPreviewToken;
        return token
          ? request<Entry>(`/api/v1/public/preview/${contentType}/${slug}?token=${encodeURIComponent(token)}`)
          : request<Entry>(`/api/v1/public/${contentType}/${slug}`);
      },
      preview({ contentType, slug, token }) {
        return request<Entry>(`/api/v1/public/preview/${contentType}/${slug}?token=${encodeURIComponent(token)}`);
      },
    },
    media: {
      url({ id }) {
        return `${baseUrl}/api/v1/public/media/${id}/file`;
      },
      get({ id }) {
        return request<PublicMedia>(`/api/v1/public/media/${id}`);
      },
      async byFolder({ slug }) {
        const items = await request<PublicMediaListItem[]>(`/api/v1/public/media/folders/${slug}`);
        return items ?? [];
      },
    },
    forms: {
      async submit({ formSlug, data }) {
        const path = `/api/v1/public/forms/${formSlug}/submissions`;
        const response = await doFetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: string; issues?: FormSubmissionIssue[] }
            | null;
          throw new KenresoftApiError(
            response.status,
            body?.error ?? `Kenresoft CMS API request failed: POST ${path} -> ${response.status}`,
            body?.issues,
          );
        }

        return (await response.json()) as FormSubmission;
      },
    },
    globalVariables: {
      async list() {
        const variables = await request<Record<string, string>>('/api/v1/public/global-variables');
        return variables ?? {};
      },
    },
    routePatterns: {
      async list() {
        const patterns = await request<RoutePatternEntry[]>('/api/v1/public/route-patterns');
        return patterns ?? [];
      },
    },
    pages: {
      async list() {
        const pages = await request<PageListItem[]>('/api/v1/public/pages');
        return pages ?? [];
      },
      resolve({ route, previewToken }) {
        const token = previewToken !== undefined ? previewToken : defaultPreviewToken;
        return token
          ? request<Page>(
              `/api/v1/public/preview/pages?route=${encodeURIComponent(route)}&token=${encodeURIComponent(token)}`,
            )
          : request<Page>(`/api/v1/public/pages/by-route?route=${encodeURIComponent(route)}`);
      },
      preview({ route, token }) {
        return request<Page>(
          `/api/v1/public/preview/pages?route=${encodeURIComponent(route)}&token=${encodeURIComponent(token)}`,
        );
      },
    },
    reusableBlocks: {
      get({ id }) {
        return request<ReusableBlock>(`/api/v1/public/reusable-blocks/${id}`);
      },
    },
    settings: {
      async general() {
        return (await request<GeneralSettingsData>('/api/v1/public/settings/general')) ?? {};
      },
      async contact() {
        return (await request<ContactSettingsData>('/api/v1/public/settings/contact')) ?? {};
      },
      async social() {
        return (await request<SocialSettingsData>('/api/v1/public/settings/social')) ?? {};
      },
      async navigation() {
        return (await request<NavigationSettingsData>('/api/v1/public/settings/navigation')) ?? {};
      },
      async footer() {
        return (await request<FooterSettingsData>('/api/v1/public/settings/footer')) ?? {};
      },
      async seo() {
        return (await request<SeoSettingsData>('/api/v1/public/settings/seo')) ?? {};
      },
    },
    commerce: {
      customerAuth: {
        register: (options) => auth.signUp(options),
        async login(options) {
          const result = await auth.signIn(options);
          if (result.twoFactorRequired) {
            // This adapter resolves a customer profile, which doesn't exist until the second
            // factor is verified. Use client.auth.signIn() + client.auth.twoFactor.* directly
            // for accounts with two-factor enabled.
            throw new KenresoftApiError(401, 'Two-factor authentication is required for this account.', undefined, 'TWO_FACTOR_REQUIRED');
          }
          const customer = await currentCustomer();
          if (!customer) throw new KenresoftApiError(401, 'Signed in, but no session cookie reached the browser.');
          return customer;
        },
        async verifyTwoFactor({ method = 'totp', ...options }) {
          if (method === 'backup-code') await auth.twoFactor.verifyBackupCode(options);
          else await auth.twoFactor.verifyTotp(options);
          const customer = await currentCustomer();
          if (!customer) throw new KenresoftApiError(401, 'Signed in, but no session cookie reached the browser.');
          return customer;
        },
        logout: () => auth.signOut(),
        requestPasswordReset: (options) => auth.requestPasswordReset(options),
        confirmPasswordReset: (options) => auth.resetPassword(options),
        verifyEmail: (options) => auth.verifyEmail(options),
        resendVerificationEmail: (options) => auth.resendVerificationEmail(options),
      },
      customer: {
        get() {
          return currentCustomer();
        },
        update(options) {
          return commerceRequest<CommerceCustomer>('/customer', { method: 'PATCH', body: JSON.stringify(options) });
        },
        changePassword: (options) => auth.changePassword(options),
        addresses: {
          list() {
            return commerceRequest<CommerceCustomerAddress[]>('/customer/addresses');
          },
          create(options) {
            return commerceRequest<CommerceCustomerAddress>('/customer/addresses', { method: 'POST', body: JSON.stringify(options) });
          },
          update(id, options) {
            return commerceRequest<CommerceCustomerAddress>(`/customer/addresses/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: JSON.stringify(options),
            });
          },
          async remove(id) {
            await commerceRequest<undefined>(`/customer/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' });
          },
        },
        orders: {
          list() {
            return commerceRequest<CommerceOrderSummary[]>('/customer/orders');
          },
          get(id) {
            return commerceRequest<CommerceOrderDetail>(`/customer/orders/${encodeURIComponent(id)}`);
          },
        },
      },
      categories: {
        list() {
          return commerceRequest<CommerceCategory[]>('/categories');
        },
      },
      products: {
        list({ categoryId } = {}) {
          const query = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : '';
          return commerceRequest<CommerceProduct[]>(`/products${query}`);
        },
        get({ slug }) {
          return commerceRequestOrNull<CommerceProductDetail>(`/products/${encodeURIComponent(slug)}`);
        },
      },
      cart: {
        get() {
          return commerceRequest<CommerceCart>('/cart');
        },
        addItem(options) {
          return commerceRequest<CommerceCart>('/cart/items', { method: 'POST', body: JSON.stringify(options) });
        },
        updateItem({ itemId, quantity }) {
          return commerceRequest<CommerceCart>(`/cart/items/${encodeURIComponent(itemId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ quantity }),
          });
        },
        removeItem({ itemId }) {
          return commerceRequest<CommerceCart>(`/cart/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
        },
        async clear() {
          await commerceRequest<undefined>('/cart', { method: 'DELETE' });
        },
      },
      checkout: {
        submit({ idempotencyKey, ...body }) {
          return commerceRequest<CommerceOrder>('/checkout', {
            method: 'POST',
            headers: { 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify(body),
          });
        },
      },
      payments: {
        initialize({ orderId, callbackUrl }) {
          return commerceRequest<CommercePaymentSession>(`/payments/orders/${encodeURIComponent(orderId)}/initialize`, {
            method: 'POST',
            body: JSON.stringify({ callbackUrl }),
          });
        },
        verify({ orderId, reference }) {
          return commerceRequest<CommercePaymentStatus>(
            `/payments/orders/${encodeURIComponent(orderId)}/verify?reference=${encodeURIComponent(reference)}`,
          );
        },
      },
    },
  };
}
