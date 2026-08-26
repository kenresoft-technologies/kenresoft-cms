import type { MediaContentType } from '@kenresoft/database';

export interface SniffedImage {
  contentType: MediaContentType;
  width: number | null;
  height: number | null;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!
  );
}

function matchesSignature(bytes: Uint8Array, signature: number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
}

function sniffPng(bytes: Uint8Array): SniffedImage | null {
  if (!matchesSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || bytes.length < 24) {
    return null;
  }
  // IHDR is always the first chunk: 4-byte length, 4-byte "IHDR", then 4-byte width, 4-byte height.
  return { contentType: 'image/png', width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
}

function sniffGif(bytes: Uint8Array): SniffedImage | null {
  if (!matchesSignature(bytes, [0x47, 0x49, 0x46, 0x38]) || bytes.length < 10) return null;
  return { contentType: 'image/gif', width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8) };
}

// Walks JFIF segment markers looking for a Start-Of-Frame marker, which carries the pixel
// dimensions. Segment length is unbounded, so unlike PNG/GIF this can't read a fixed offset.
function sniffJpeg(bytes: Uint8Array): SniffedImage | null {
  if (!matchesSignature(bytes, [0xff, 0xd8, 0xff])) return null;

  let offset = 2;
  while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) break; // end of image

    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { contentType: 'image/jpeg', height: readUint16BE(bytes, offset + 5), width: readUint16BE(bytes, offset + 7) };
    }

    offset += 2 + readUint16BE(bytes, offset + 2);
  }
  return { contentType: 'image/jpeg', width: null, height: null };
}

// Dimension parsing isn't implemented for WebP (VP8/VP8L/VP8X each encode it differently) —
// verified as WebP by its container signature only, dimensions stay null (see media schema).
function sniffWebp(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 12 || !matchesSignature(bytes, [0x52, 0x49, 0x46, 0x46])) return null;
  const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return isWebp ? { contentType: 'image/webp', width: null, height: null } : null;
}

// Verifies the file's actual bytes rather than trusting the client-supplied Content-Type
// (§9) — returns null if the bytes don't match any supported signature, regardless of what
// the upload claimed to be.
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  return sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffGif(bytes) ?? sniffWebp(bytes);
}
