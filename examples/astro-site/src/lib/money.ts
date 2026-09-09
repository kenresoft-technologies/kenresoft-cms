// Commerce prices are integer minor units (docs/PLUGINS.md: "never floating point") — this
// assumes 2 decimal places (cents/kobo-style), true for every currency this project's own tests
// exercise (NGN) and the overwhelming majority of ISO 4217 currencies, but not a universal
// guarantee (JPY has none, some currencies have 3) — the plugin's own schema doesn't record a
// per-currency minor-unit count to divide by correctly in every case, so this is a documented
// simplification for this example, not something a production storefront should copy blindly for
// a deployment selling in a zero-decimal currency.
export function formatMoney(amountMinorUnits: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountMinorUnits / 100);
}
