import type { ImportExternalMediaInput, PixabaySearchResponse } from '@kenresoft-cms/contracts';

export type FetchExternalImageResult =
  | { ok: true; bytes: Uint8Array; filename: string }
  | { ok: false; error: string };

// Picsum needs no API key. Pixabay (below) is the keyword-searchable source and needs the
// PIXABAY_API_KEY Worker secret; Picsum stays as the zero-setup fallback.
function picsumUrl(
  input: Pick<ImportExternalMediaInput, 'width' | 'height' | 'seed' | 'pictureId' | 'grayscale' | 'blur'>,
): string {
  const base = input.pictureId
    ? `https://picsum.photos/id/${encodeURIComponent(input.pictureId)}/${input.width}/${input.height}`
    : input.seed
      ? `https://picsum.photos/seed/${encodeURIComponent(input.seed)}/${input.width}/${input.height}`
      : `https://picsum.photos/${input.width}/${input.height}`;

  const params = new URLSearchParams();
  if (input.grayscale) params.set('grayscale', '');
  if (input.blur) params.set('blur', String(input.blur));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

// An import's `imageUrl` comes from the client, so it's only ever fetched if it's https on
// pixabay.com or one of its subdomains (its image CDN is cdn.pixabay.com) — anything else would
// let an editor make this Worker fetch an arbitrary URL.
export function isPixabayImageUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && (url.hostname === 'pixabay.com' || url.hostname.endsWith('.pixabay.com'));
}

type PixabayApiHit = {
  id: number;
  pageURL: string;
  tags: string;
  previewURL: string;
  webformatURL: string;
  largeImageURL: string;
  imageWidth: number;
  imageHeight: number;
  user: string;
};

const PIXABAY_PER_PAGE = 24;

export async function searchPixabay(
  apiKey: string | undefined,
  query: string,
  page: number,
): Promise<{ ok: true; result: PixabaySearchResponse } | { ok: false; error: string }> {
  if (!apiKey) return { ok: true, result: { configured: false, total: 0, hits: [] } };

  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    image_type: 'photo',
    safesearch: 'true',
    per_page: String(PIXABAY_PER_PAGE),
    page: String(page),
  });
  let response: Response;
  try {
    // Pixabay's terms ask API consumers to cache results for 24h; an hour at the edge keeps
    // repeat searches cheap and well inside their 100 requests/minute limit.
    response = await fetch(`https://pixabay.com/api/?${params}`, {
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
  } catch {
    return { ok: false, error: 'Failed to reach Pixabay' };
  }
  if (response.status === 429) return { ok: false, error: 'Pixabay rate limit reached — try again in a minute' };
  if (!response.ok) {
    return {
      ok: false,
      error: response.status === 400 ? 'Pixabay rejected the request — check PIXABAY_API_KEY' : `Pixabay returned ${response.status}`,
    };
  }

  const body = (await response.json().catch(() => null)) as { totalHits?: number; hits?: PixabayApiHit[] } | null;
  if (!body || !Array.isArray(body.hits)) return { ok: false, error: 'Unexpected response from Pixabay' };

  return {
    ok: true,
    result: {
      configured: true,
      total: body.totalHits ?? body.hits.length,
      hits: body.hits.map((hit) => ({
        id: hit.id,
        previewUrl: hit.webformatURL || hit.previewURL,
        imageUrl: hit.largeImageURL,
        width: hit.imageWidth,
        height: hit.imageHeight,
        user: hit.user,
        pageUrl: hit.pageURL,
        tags: hit.tags,
      })),
    },
  };
}

export async function fetchExternalImage(input: ImportExternalMediaInput): Promise<FetchExternalImageResult> {
  let url: string;
  let filename: string;
  if (input.source === 'picsum') {
    url = picsumUrl(input);
    filename = `picsum-${input.pictureId ?? input.seed ?? crypto.randomUUID()}-${input.width}x${input.height}.jpg`;
  } else if (input.source === 'pixabay') {
    if (!input.imageUrl || !isPixabayImageUrl(input.imageUrl)) {
      return { ok: false, error: 'imageUrl must be an https pixabay.com image URL' };
    }
    url = input.imageUrl;
    const ext = /\.(jpe?g|png|webp|gif)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase() ?? 'jpg';
    filename = `pixabay-${input.pictureId ?? crypto.randomUUID()}.${ext}`;
  } else {
    return { ok: false, error: `Unknown external media source: ${input.source}` };
  }

  let response: Response;
  try {
    // Manual redirects for Pixabay: the host check above only covers the URL we were given, so a
    // redirect off pixabay.com must not be followed.
    response = await fetch(url, { redirect: input.source === 'pixabay' ? 'manual' : 'follow' });
  } catch {
    return { ok: false, error: 'Failed to reach the external image source' };
  }
  if (!response.ok) {
    return { ok: false, error: `External image source returned ${response.status}` };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return { ok: true, bytes, filename };
}
