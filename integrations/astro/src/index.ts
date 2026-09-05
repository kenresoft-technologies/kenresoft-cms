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
}

export function createKenresoftClient(config: KenresoftClientConfig): KenresoftClient {
  const baseUrl = config.url.replace(/\/$/, '');
  const doFetch = config.fetch ?? fetch;

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
  };
}
