// A minimal, standalone client for a Kenresoft CMS deployment's public API
// (docs/ARCHITECTURE.md §8/§20 Phase 6) — deliberately hand-written against the plain REST
// shape rather than importing @kenresoft/contracts, since a real external Astro site
// wouldn't have access to this monorepo's internal packages. See that package if you do have
// access to it and want the exact, always-in-sync response types instead of this copy.
export interface CmsEntry {
  id: string;
  contentTypeId: string;
  slug: string;
  status: 'draft' | 'published';
  // Shape depends entirely on the content type's own field definitions — there's no
  // server-side schema for this beyond "valid JSON object" (see the Entry domain model in
  // docs/ARCHITECTURE.md §8). The field names used by the pages in this example (title, body,
  // excerpt) are a suggestion, not a contract — match them to whatever fields you actually
  // define on your Blog Post content type in the admin.
  data: Record<string, unknown>;
  publishAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const API_URL = import.meta.env.API_URL ?? 'http://localhost:8787';

async function get<T>(path: string): Promise<T | null> {
  const response = await fetch(`${API_URL}${path}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Kenresoft CMS API request failed: GET ${path} -> ${response.status}`);
  }
  return response.json();
}

// Public listing/detail routes only ever return published entries — a draft matching the
// requested slug 404s exactly like a slug that doesn't exist (docs/ARCHITECTURE.md §6/§14),
// so there's no separate "is this actually published" check needed here.
export async function listPublishedEntries(contentTypeSlug: string): Promise<CmsEntry[]> {
  const entries = await get<CmsEntry[]>(`/api/v1/public/${contentTypeSlug}`);
  return entries ?? [];
}

export async function getPublishedEntry(contentTypeSlug: string, slug: string): Promise<CmsEntry | null> {
  return get<CmsEntry>(`/api/v1/public/${contentTypeSlug}/${slug}`);
}
