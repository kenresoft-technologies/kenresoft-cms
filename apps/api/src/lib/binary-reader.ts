// Tiny byte-reading helpers shared by every format sniffer that verifies an upload's actual
// bytes rather than trusting a client-supplied Content-Type/extension (§9) — image-metadata.ts
// and attachment-metadata.ts both import from here instead of each keeping their own copy.

export function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

export function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
  );
}

export function matchesSignature(bytes: Uint8Array, signature: number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
}
