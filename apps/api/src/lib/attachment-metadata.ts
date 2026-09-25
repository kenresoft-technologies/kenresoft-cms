import { matchesSignature, readUint16LE, readUint32LE } from './binary-reader';
import { sniffImage } from './image-metadata';

export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type AttachmentContentType =
  | 'application/pdf'
  | typeof DOCX_CONTENT_TYPE
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp';

export interface SniffedAttachment {
  contentType: AttachmentContentType;
  extension: string;
}

function sniffPdf(bytes: Uint8Array): SniffedAttachment | null {
  return matchesSignature(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) // "%PDF-"
    ? { contentType: 'application/pdf', extension: 'pdf' }
    : null;
}

// A DOCX file is a ZIP container — matching the ZIP local-file-header signature only proves
// "this is *a* ZIP", the same signature every XLSX/PPTX/generic .zip shares. Real verification
// walks the ZIP's central directory (no decompression needed, just the file-name listing) and
// requires both `[Content_Types].xml` (present in any OOXML package) and `word/document.xml`
// (present only in a WordprocessingML — i.e. actually a Word — document) before accepting it.
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50;
const ZIP_MAX_COMMENT_LENGTH = 65535;

function findZipEndOfCentralDirectory(bytes: Uint8Array): number | null {
  const minPosition = Math.max(0, bytes.length - 22 - ZIP_MAX_COMMENT_LENGTH);
  for (let offset = bytes.length - 22; offset >= minPosition; offset--) {
    if (readUint32LE(bytes, offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  return null;
}

function listZipEntryNames(bytes: Uint8Array): string[] | null {
  const eocdOffset = findZipEndOfCentralDirectory(bytes);
  if (eocdOffset === null) return null;

  const totalEntries = readUint16LE(bytes, eocdOffset + 10);
  let offset = readUint32LE(bytes, eocdOffset + 16);
  const decoder = new TextDecoder();
  const names: string[] = [];

  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > bytes.length || readUint32LE(bytes, offset) !== ZIP_CENTRAL_DIR_SIGNATURE) {
      return null;
    }
    const nameLength = readUint16LE(bytes, offset + 28);
    const extraLength = readUint16LE(bytes, offset + 30);
    const commentLength = readUint16LE(bytes, offset + 32);
    const nameStart = offset + 46;
    names.push(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)));
    offset = nameStart + nameLength + extraLength + commentLength;
  }

  return names;
}

function sniffDocx(bytes: Uint8Array): SniffedAttachment | null {
  if (!matchesSignature(bytes, [0x50, 0x4b, 0x03, 0x04])) return null;

  const names = listZipEntryNames(bytes);
  if (!names) return null;

  const isOoxml = names.includes('[Content_Types].xml');
  const isWordDocument = names.includes('word/document.xml');
  // A macro-enabled document (.docm) renamed to .docx has the same structure plus a VBA project.
  // It isn't a plain .docx, so it's refused rather than stored and handed on to staff.
  const hasMacros = names.includes('word/vbaProject.bin');
  return isOoxml && isWordDocument && !hasMacros ? { contentType: DOCX_CONTENT_TYPE, extension: 'docx' } : null;
}

// The kinds a form's file field can be limited to through its config.accept (e.g.
// { accept: ['pdf', 'docx'] }). A field without that setting accepts all of them.
export const ATTACHMENT_KINDS = {
  pdf: { label: 'PDF', contentTypes: ['application/pdf'] },
  docx: { label: 'DOCX', contentTypes: [DOCX_CONTENT_TYPE] },
  image: { label: 'image', contentTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
} as const satisfies Record<string, { label: string; contentTypes: AttachmentContentType[] }>;

export type AttachmentKind = keyof typeof ATTACHMENT_KINDS;

// Unknown values are ignored. An empty or missing list means every kind is accepted.
export function acceptedAttachmentKinds(config: Record<string, unknown> | null | undefined): AttachmentKind[] | null {
  const accept = config?.['accept'];
  if (!Array.isArray(accept)) return null;
  const kinds = accept.filter((kind): kind is AttachmentKind => typeof kind === 'string' && kind in ATTACHMENT_KINDS);
  return kinds.length > 0 ? kinds : null;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

// Verifies the file's actual bytes rather than trusting the client-supplied Content-Type/
// extension (§9), same standard as sniffImage — legacy binary .doc is deliberately not
// supported here, since (unlike PDF's magic bytes or DOCX's ZIP structure) it has no comparable
// lightweight structural check.
export function sniffAttachment(bytes: Uint8Array): SniffedAttachment | null {
  const image = sniffImage(bytes);
  if (image) return { contentType: image.contentType, extension: IMAGE_EXTENSIONS[image.contentType]! };

  return sniffPdf(bytes) ?? sniffDocx(bytes);
}
