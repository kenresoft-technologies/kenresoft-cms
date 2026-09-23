import type { ImportExternalMediaInput } from '@kenresoft-cms/contracts';

export type FetchExternalImageResult =
  | { ok: true; bytes: Uint8Array; filename: string }
  | { ok: false; error: string };

// No API key needed — the only reason Picsum is the source implemented so far (see
// IMPORT_MEDIA_SOURCES's own comment). Adding a second, key-requiring provider (Pixabay,
// Unsplash, ...) means threading a Worker secret through here the same way EMAIL_PROVIDER/
// PAYSTACK_SECRET_KEY already do, deliberately left for whenever that's a real, driving need
// rather than built speculatively ahead of one.
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
  const identifier = input.pictureId ?? input.seed ?? crypto.randomUUID();
  const filename = `${input.source}-${identifier}-${input.width}x${input.height}.jpg`;
  return { ok: true, bytes, filename };
}
