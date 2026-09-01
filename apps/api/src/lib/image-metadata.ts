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

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
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

// WebP wraps one of three distinct bitstream formats in a RIFF container, each encoding width/
// height differently — the sub-chunk FourCC right after "WEBP" says which. Dimensions fall
// back to null (still a recognized WebP) if the file is too short to read them or the payload
// doesn't start where these formats expect, rather than throwing on a malformed upload.
function sniffWebp(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 12 || !matchesSignature(bytes, [0x52, 0x49, 0x46, 0x46])) return null;
  const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!isWebp) return null;

  const unknown: SniffedImage = { contentType: 'image/webp', width: null, height: null };
  if (bytes.length < 16) return unknown;

  const fourCc = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  const payload = 20; // sub-chunk data starts after its 4-byte FourCC + 4-byte size header

  if (fourCc === 'VP8 ' && bytes.length >= payload + 10) {
    // Lossy key-frame bitstream: 3-byte frame tag, then a 3-byte sync code (0x9d 0x01 0x2a),
    // then little-endian 16-bit width/height where only the low 14 bits are the pixel
    // dimension (the top 2 bits are an upscale factor, not part of the size).
    if (bytes[payload + 3] === 0x9d && bytes[payload + 4] === 0x01 && bytes[payload + 5] === 0x2a) {
      return {
        contentType: 'image/webp',
        width: readUint16LE(bytes, payload + 6) & 0x3fff,
        height: readUint16LE(bytes, payload + 8) & 0x3fff,
      };
    }
  } else if (fourCc === 'VP8L' && bytes.length >= payload + 5) {
    // Lossless bitstream: 1-byte signature (0x2f), then a packed little-endian 32-bit field —
    // 14 bits width-1, 14 bits height-1, 1 bit alpha flag, 3 bits version (reserved).
    if (bytes[payload] === 0x2f) {
      const packed = readUint32LE(bytes, payload + 1);
      return {
        contentType: 'image/webp',
        width: (packed & 0x3fff) + 1,
        height: ((packed >>> 14) & 0x3fff) + 1,
      };
    }
  } else if (fourCc === 'VP8X' && bytes.length >= payload + 10) {
    // Extended format (used when the file carries animation/alpha/ICC/EXIF/XMP alongside the
    // image): 1-byte flags, 3 reserved bytes, then 24-bit little-endian canvas-width-1 and
    // canvas-height-1.
    return {
      contentType: 'image/webp',
      width: readUint24LE(bytes, payload + 4) + 1,
      height: readUint24LE(bytes, payload + 7) + 1,
    };
  }

  return unknown;
}

// Verifies the file's actual bytes rather than trusting the client-supplied Content-Type
// (§9) — returns null if the bytes don't match any supported signature, regardless of what
// the upload claimed to be.
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  return sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffGif(bytes) ?? sniffWebp(bytes);
}
