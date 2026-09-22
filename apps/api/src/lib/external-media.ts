import type { ImportExternalMediaInput } from '@kenresoft-cms/contracts';

export type FetchExternalImageResult =
  | { ok: true; bytes: Uint8Array; filename: string }
  | { ok: false; error: string };

// No API key needed — the only reason Picsum is the source implemented so far (see
// IMPORT_MEDIA_SOURCES's own comment). Adding a second, key-requiring provider (Pixabay,
// Unsplash, ...) means threading a Worker secret through here the same way EMAIL_PROVIDER/
// PAYSTACK_SECRET_KEY already do, deliberately left for whenever that's a real, driving need
// rather than built speculatively ahead of one.
function picsumUrl(input: Pick<ImportExternalMediaInput, 'width' | 'height' | 'seed'>): string {
  const base = input.seed
    ? `https://picsum.photos/seed/${encodeURIComponent(input.seed)}/${input.width}/${input.height}`
    : `https://picsum.photos/${input.width}/${input.height}`;
  return base;
}

export async function fetchExternalImage(input: ImportExternalMediaInput): Promise<FetchExternalImageResult> {
  const url = input.source === 'picsum' ? picsumUrl(input) : null;
  if (!url) {
    return { ok: false, error: `Unknown external media source: ${input.source}` };
  }

  let response: Response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch {
    return { ok: false, error: 'Failed to reach the external image source' };
  }
  if (!response.ok) {
    return { ok: false, error: `External image source returned ${response.status}` };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const filename = `${input.source}-${input.seed ?? crypto.randomUUID()}-${input.width}x${input.height}.jpg`;
  return { ok: true, bytes, filename };
}
