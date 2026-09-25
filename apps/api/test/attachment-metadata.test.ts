import { describe, expect, it } from 'vitest';

import { DOCX_CONTENT_TYPE, sniffAttachment } from '../src/lib/attachment-metadata';
import { buildZip } from './helpers/zip';

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

  it('rejects a macro-enabled Word document renamed to .docx', () => {
    const bytes = buildZip(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin']);
    expect(sniffAttachment(bytes)).toBeNull();
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
