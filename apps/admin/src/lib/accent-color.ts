// Deterministic per-content-type accent color (Strapi/SonicJS-style colored collection pills) —
// the same content type always gets the same color across the app without storing one, by
// hashing its id/slug into one of the fixed --swatch-1..6 tokens (index.css, registered under
// @theme inline as --color-swatch-1..6, so Tailwind generates real bg-swatch-N/text-swatch-N
// utilities with opacity-modifier support — same pattern index.css already uses for
// bg-accent-brand/25 on Tiptap's highlight mark).
const SWATCH_CLASSES = [
  'bg-swatch-1/14 text-swatch-1 border-swatch-1/30',
  'bg-swatch-2/14 text-swatch-2 border-swatch-2/30',
  'bg-swatch-3/14 text-swatch-3 border-swatch-3/30',
  'bg-swatch-4/14 text-swatch-4 border-swatch-4/30',
  'bg-swatch-5/14 text-swatch-5 border-swatch-5/30',
  'bg-swatch-6/14 text-swatch-6 border-swatch-6/30',
] as const;

function hashToIndex(key: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % modulo;
}

export function swatchClasses(key: string): string {
  return SWATCH_CLASSES[hashToIndex(key, SWATCH_CLASSES.length)] ?? SWATCH_CLASSES[0];
}
