// Builds a minimal, real, parseable ZIP archive (stored/uncompressed entries, empty content) —
// enough for the central-directory walk sniffAttachment does, without needing an actual
// compression library or a checked-in binary fixture.
export function buildZip(fileNames: string[]): Uint8Array {
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
