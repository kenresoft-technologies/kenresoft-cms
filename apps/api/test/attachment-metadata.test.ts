import { describe, expect, it } from 'vitest';

import { DOCX_CONTENT_TYPE, sniffAttachment } from '../src/lib/attachment-metadata';

// Builds a minimal, real, parseable ZIP archive (stored/uncompressed entries, empty content) —
// enough for the central-directory walk sniffAttachment does, without needing an actual
// compression library or a checked-in binary fixture.
function buildZip(fileNames: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: number[] = [];
  const centralParts: number[] = [];
  const offsets: number[] = [];

  function u16(value: number) {
    return [value & 0xff, (value >> 8) & 0xff];
  }
  function u32(value: number) {
    return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
  }

  for (const name of fileNames) {
    const nameBytes = Array.from(encoder.encode(name));
    offsets.push(localParts.length);
    localParts.push(
      ...u32(0x04034b50), // local file header signature
      ...u16(20), // version needed
      ...u16(0), // flags
      ...u16(0), // compression method: stored
      ...u16(0), // mod time
      ...u16(0), // mod date
      ...u32(0), // crc-32
      ...u32(0), // compressed size
      ...u32(0), // uncompressed size
      ...u16(nameBytes.length),
      ...u16(0), // extra field length
      ...nameBytes,
    );
  }

  const centralDirStart = localParts.length;
  fileNames.forEach((name, i) => {
    const nameBytes = Array.from(encoder.encode(name));
    centralParts.push(
      ...u32(0x02014b50), // central directory header signature
      ...u16(20), // version made by
      ...u16(20), // version needed
      ...u16(0), // flags
      ...u16(0), // compression method
      ...u16(0), // mod time
      ...u16(0), // mod date
      ...u32(0), // crc-32
      ...u32(0), // compressed size
      ...u32(0), // uncompressed size
      ...u16(nameBytes.length),
      ...u16(0), // extra field length
      ...u16(0), // comment length
      ...u16(0), // disk number start
      ...u16(0), // internal attrs
      ...u32(0), // external attrs
      ...u32(offsets[i]!), // relative offset of local header
      ...nameBytes,
    );
  });

  const eocd = [
    ...u32(0x06054b50),
    ...u16(0), // disk number
    ...u16(0), // disk with central dir
    ...u16(fileNames.length), // entries on this disk
    ...u16(fileNames.length), // total entries
    ...u32(centralParts.length), // central dir size
    ...u32(centralDirStart), // central dir offset
    ...u16(0), // comment length
  ];

  return new Uint8Array([...localParts, ...centralParts, ...eocd]);
}

describe('sniffAttachment', () => {
  it('accepts a real PNG via the shared image sniffer', () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01,
      0x00, 0x00, 0x00, 0x01,
    ]);
    expect(sniffAttachment(bytes)).toEqual({ contentType: 'image/png', extension: 'png' });
  });

  it('accepts PDF magic bytes', () => {
    const bytes = new TextEncoder().encode('%PDF-1.4\n%...');
    expect(sniffAttachment(bytes)).toEqual({ contentType: 'application/pdf', extension: 'pdf' });
  });

  it('rejects a truncated/fake PDF signature', () => {
    const bytes = new TextEncoder().encode('%PDF');
    expect(sniffAttachment(bytes)).toBeNull();
  });

  it('accepts a real DOCX (a ZIP containing [Content_Types].xml and word/document.xml)', () => {
    const bytes = buildZip(['[Content_Types].xml', 'word/document.xml', 'word/styles.xml']);
    expect(sniffAttachment(bytes)).toEqual({ contentType: DOCX_CONTENT_TYPE, extension: 'docx' });
  });

  it('rejects an XLSX (same OOXML container, no word/document.xml)', () => {
    const bytes = buildZip(['[Content_Types].xml', 'xl/workbook.xml']);
    expect(sniffAttachment(bytes)).toBeNull();
  });

  it('rejects a generic ZIP with no OOXML structure at all', () => {
    const bytes = buildZip(['readme.txt', 'notes.md']);
    expect(sniffAttachment(bytes)).toBeNull();
  });

  it('rejects bytes that match no supported signature at all', () => {
    expect(sniffAttachment(new TextEncoder().encode('just some plain text'))).toBeNull();
  });

  it('rejects empty input', () => {
    expect(sniffAttachment(new Uint8Array())).toBeNull();
  });
});
