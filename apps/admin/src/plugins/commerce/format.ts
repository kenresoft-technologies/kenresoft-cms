// basePrice/price are stored as integer minor units (e.g. cents) — never floating point
// (docs/PLUGINS.md's Commerce money convention). Intl.NumberFormat's 'currency' style expects
// the major-unit float, so this divides by 100 before formatting; falls back to a plain
// "1234.56 XYZ" string if the currency code isn't one Intl recognizes.
export function formatMoney(minorUnits: number, currency: string): string {
  const majorUnits = minorUnits / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(majorUnits);
  } catch {
    return `${majorUnits.toFixed(2)} ${currency}`;
  }
}
