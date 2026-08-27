import type { Entry } from '@kenresoft/contracts';

// Type-only import — Entry is erased at compile time, so this package never actually depends
// on zod (or anything else @kenresoft/contracts pulls in) at runtime. It exists purely so
// this client's return types stay in sync with the API's real response shape instead of a
// hand-maintained copy — see the "Types" note in docs/ASTRO.md.
export type { Entry };

export interface KenresoftClientConfig {
  /** Base URL of a Kenresoft CMS deployment, e.g. "http://localhost:8787" in local dev. */
  url: string;
  /** Override for testing — defaults to the global fetch. */
  fetch?: typeof fetch;
}

// Thrown for any non-2xx, non-404 response. A 404 is not an error from this client's
// perspective — see notFound() below — since "no content type with that slug" and "no
// published entry with that slug" are both normal, expected outcomes for public content.
export class KenresoftApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'KenresoftApiError';
    this.status = status;
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
    },
  };
}
