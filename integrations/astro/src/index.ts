import type { Entry, FormSubmission, PublicMedia } from '@kenresoft-cms/contracts';

// Type-only imports — erased at compile time, so this package never actually depends on zod
// (or anything else @kenresoft-cms/contracts pulls in) at runtime. They exist purely so this
// client's return types stay in sync with the API's real response shapes instead of a
// hand-maintained copy — see the "Types" note in docs/ASTRO.md.
export type { Entry, FormSubmission, PublicMedia };

export interface KenresoftClientConfig {
  /** Base URL of a Kenresoft CMS deployment, e.g. "http://localhost:8787" in local dev. */
  url: string;
  /** Override for testing — defaults to the global fetch. */
  fetch?: typeof fetch;
}

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
  phone?: string | null;
}

export interface LoginCustomerOptions {
  email: string;
  password: string;
}

export interface RequestCustomerPasswordResetOptions {
  email: string;
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

export interface FormSubmissionIssue {
  path: (string | number)[];
  message: string;
}

// Thrown for any non-2xx, non-404 response from entries.list/entries.get (a 404 there is not
// an error from this client's perspective — see request() below — since "no content type with
// that slug" and "no published entry with that slug" are both normal, expected outcomes for
// public content), and for ANY non-2xx response from forms.submit, where 400/404/429 are all
// meaningfully different outcomes a caller needs to handle, not something to paper over as
// null. `issues` is populated only for a 400 from forms.submit — the form-specific field
// validation errors (apps/api/src/lib/form-submission-validation.ts).
export class KenresoftApiError extends Error {
  status: number;
  issues: FormSubmissionIssue[] | undefined;

  constructor(status: number, message: string, issues?: FormSubmissionIssue[]) {
    super(message);
    this.name = 'KenresoftApiError';
    this.status = status;
    this.issues = issues;
  }
}

export interface ListEntriesOptions {
  /** The content type's slug (not its display name) — e.g. "blog-post". */
  contentType: string;
}

export interface GetEntryOptions extends ListEntriesOptions {
  /** The entry's own slug within that content type. */
  slug: string;
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
     * exist, from the public API's perspective).
     */
    get(options: GetEntryOptions): Promise<Entry | null>;
    /**
     * Fetches one entry regardless of draft/published status, given a valid preview token for
     * it — see `PreviewEntryOptions.token`. Powers Live Preview; not used for normal rendering.
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
   * The Commerce plugin's storefront surface (packages/plugin-ecommerce) — catalog, cart,
   * checkout, and Paystack payment confirmation. Only present/meaningful on a deployment that
   * has the commerce plugin installed and enabled; calling these against one that doesn't will
   * 404 the same way any disabled-plugin route does (docs/PLUGINS.md's enablement section).
   * Deliberately guest-only for now — customer account registration/login/order-history and
   * saved addresses aren't wired into this client yet (a real, separate follow-up: guest
   * checkout is already Commerce's own complete, independently-supported purchase path, per
   * docs/PLUGINS.md's Phase 2b/2c design, not a stopgap).
   */
  commerce: {
    /**
     * Customer account registration/login/logout/password-reset/email-verification — the
     * genuinely unauthenticated auth surface itself (packages/plugin-ecommerce/src/routes/
     * customer-auth.ts). Separate from Core's own better-auth staff accounts entirely; a
     * storefront customer and a CMS staff member are different identity systems.
     */
    customerAuth: {
      /** Throws KenresoftApiError (409) if that email is already registered. Signs the browser in on success. */
      register(options: RegisterCustomerOptions): Promise<CommerceCustomer>;
      /** Throws KenresoftApiError (401) for any invalid-credentials reason — deliberately identical whether the email exists, the password is wrong, or the account is disabled. */
      login(options: LoginCustomerOptions): Promise<CommerceCustomer>;
      /** Idempotent — safe to call with no session. */
      logout(): Promise<void>;
      /** Always resolves with the same generic message regardless of whether the email matches an account — never reveals account existence. */
      requestPasswordReset(options: RequestCustomerPasswordResetOptions): Promise<{ message: string }>;
      /** Throws KenresoftApiError (400) for an invalid/expired token. */
      confirmPasswordReset(options: ConfirmCustomerPasswordResetOptions): Promise<{ message: string }>;
      /** Throws KenresoftApiError (400) for an invalid/expired token. */
      verifyEmail(options: VerifyCustomerEmailOptions): Promise<{ message: string }>;
      /** Always resolves with the same generic message regardless of whether the email matches an account or is already verified — never reveals either. */
      resendVerificationEmail(options: ResendCustomerVerificationEmailOptions): Promise<{ message: string }>;
    };
    /**
     * The signed-in customer's own profile/addresses/order-history — every method throws
     * KenresoftApiError (401) with no valid customer session.
     */
    customer: {
      /** The current customer, or null with no valid session (never throws for that specific case). */
      get(): Promise<CommerceCustomer | null>;
      update(options: UpdateCustomerProfileOptions): Promise<CommerceCustomer>;
      /** Throws KenresoftApiError (400) for an incorrect currentPassword. Revokes every other session. */
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
  const doFetch = config.fetch ?? fetch;
  const commerceBase = `${baseUrl}/api/plugins/commerce/public/v1`;

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
    entries: {
      async list({ contentType }) {
        const entries = await request<Entry[]>(`/api/v1/public/${contentType}`);
        return entries ?? [];
      },
      get({ contentType, slug }) {
        return request<Entry>(`/api/v1/public/${contentType}/${slug}`);
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
    commerce: {
      customerAuth: {
        register(options) {
          return commerceRequest<CommerceCustomer>('/customer-auth/register', { method: 'POST', body: JSON.stringify(options) });
        },
        login(options) {
          return commerceRequest<CommerceCustomer>('/customer-auth/login', { method: 'POST', body: JSON.stringify(options) });
        },
        async logout() {
          await commerceRequest<undefined>('/customer-auth/logout', { method: 'POST' });
        },
        requestPasswordReset(options) {
          return commerceRequest<{ message: string }>('/customer-auth/password-reset/request', { method: 'POST', body: JSON.stringify(options) });
        },
        confirmPasswordReset(options) {
          return commerceRequest<{ message: string }>('/customer-auth/password-reset/confirm', { method: 'POST', body: JSON.stringify(options) });
        },
        verifyEmail({ token }) {
          return commerceRequest<{ message: string }>(`/customer-auth/verify-email?token=${encodeURIComponent(token)}`);
        },
        resendVerificationEmail(options) {
          return commerceRequest<{ message: string }>('/customer-auth/verify-email/resend', { method: 'POST', body: JSON.stringify(options) });
        },
      },
      customer: {
        async get() {
          const response = await doFetch(`${commerceBase}/customer`, { credentials: 'include' });
          if (response.status === 401) return null;
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new KenresoftApiError(response.status, body?.error ?? `Kenresoft CMS API request failed: GET /customer -> ${response.status}`);
          }
          return (await response.json()) as CommerceCustomer;
        },
        update(options) {
          return commerceRequest<CommerceCustomer>('/customer', { method: 'PATCH', body: JSON.stringify(options) });
        },
        changePassword(options) {
          return commerceRequest<{ message: string }>('/customer/password', { method: 'PATCH', body: JSON.stringify(options) });
        },
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
