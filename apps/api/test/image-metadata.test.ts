import { describe, expect, it } from 'vitest';

import { sniffImage } from '../src/lib/image-metadata';

describe('sniffImage', () => {
  it('parses PNG signature and IHDR dimensions', () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x01, 0x00, // width = 256
      0x00, 0x00, 0x00, 0x80, // height = 128
    ]);
    expect(sniffImage(bytes)).toEqual({ contentType: 'image/png', width: 256, height: 128 });
  });

  it('parses GIF signature and little-endian dimensions', () => {
    const bytes = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
      0x40, 0x01, // width = 320
      0xf0, 0x00, // height = 240
    ]);
    expect(sniffImage(bytes)).toEqual({ contentType: 'image/gif', width: 320, height: 240 });
  });

  it('parses JPEG dimensions from the SOF0 segment', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xc0, // SOF0
      0x00, 0x0b, // segment length (unused — we return before needing it)
      0x08, // precision
      0x00, 0x80, // height = 128
      0x01, 0x00, // width = 256
      0x01, // num components
    ]);
    expect(sniffImage(bytes)).toEqual({ contentType: 'image/jpeg', width: 256, height: 128 });
  });

  it('skips leading JFIF/EXIF segments to find SOF0', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x04, 0xaa, 0xbb, // APP0 segment, length 4, 2 bytes of payload
      0xff, 0xc0, // SOF0
      0x00, 0x0b,
      0x08,
      0x00, 0x64, // height = 100
      0x00, 0xc8, // width = 200
      0x01,
    ]);
    expect(sniffImage(bytes)).toEqual({ contentType: 'image/jpeg', width: 200, height: 100 });
  });

  it('recognizes WebP by its RIFF/WEBP container signature, with no dimensions when truncated', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // chunk size
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(sniffImage(bytes)).toEqual({ contentType: 'image/webp', width: null, height: null });
  });

  it('parses dimensions from a lossy (VP8 ) WebP bitstream', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // chunk size
      0x57, 0x45, 0x42, 0x50, // WEBP
      0x56, 0x50, 0x38, 0x20, // "VP8 "
      0x00, 0x00, 0x00, 0x00, // sub-chunk size
      0x00, 0x00, 0x00, // frame tag
      0x9d, 0x01, 0x2a, // sync code
      0xc8, 0x00, // width = 200
      0x96, 0x00, // height = 150
    ]);
    expect(sniffImage(bytes)).toEqual({ contentType: 'image/webp', width: 200, height: 150 });
  });

  it('parses dimensions from a lossless (VP8L) WebP bitstream', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // chunk size
      0x57, 0x45, 0x42, 0x50, // WEBP
      0x56, 0x50, 0x38, 0x4c, // "VP8L"
      0x00, 0x00, 0x00, 0x00, // sub-chunk size
      0x2f, // signature
      0x63, 0x40, 0x0c, 0x00, // packed width-1=99, height-1=49 -> width=100, height=50
    ]);
    expect(sniffImage(bytes)).toEqual({ contentType: 'image/webp', width: 100, height: 50 });
  });

  it('parses dimensions from an extended (VP8X) WebP container', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // chunk size
      0x57, 0x45, 0x42, 0x50, // WEBP
      0x56, 0x50, 0x38, 0x58, // "VP8X"
      0x00, 0x00, 0x00, 0x00, // sub-chunk size
      0x10, // flags
      0x00, 0x00, 0x00, // reserved
      0xff, 0x03, 0x00, // canvas-width-1 = 1023 -> width = 1024
      0xff, 0x02, 0x00, // canvas-height-1 = 767 -> height = 768
    ]);
    expect(sniffImage(bytes)).toEqual({ contentType: 'image/webp', width: 1024, height: 768 });
  });

  it('rejects bytes that match no supported image signature', () => {
    const bytes = new TextEncoder().encode('%PDF-1.4');
    expect(sniffImage(bytes)).toBeNull();
  });

  it('rejects empty input', () => {
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});
