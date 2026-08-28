// Not `import '@testing-library/jest-dom/vitest'` — that module does its own internal
// `import { expect } from 'vitest'` before extending it, and which vitest copy THAT resolves
// to is exactly the ambiguity this monorepo has (apps/api pins vitest ^3.2.4 for
// @cloudflare/vitest-pool-workers, apps/admin pins ^4.1.11 — see jest-dom-matchers.d.ts's own
// note on the equivalent TYPES version of this problem). A fresh install can hoist jest-dom's
// internal vitest import to either package depending on install order, extending the WRONG
// expect and leaving admin's own test files' `expect` without the matchers at all — reproduced
// on a clean Linux CI install even though a long-lived local Windows node_modules didn't show
// it. Importing `expect` explicitly here, from a file physically inside apps/admin, and
// extending it directly with the framework-agnostic matchers export removes that ambiguity —
// this is guaranteed to be admin's own vitest, the same one every test file's own `expect`
// comes from.
import { expect } from 'vitest';
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';

expect.extend(jestDomMatchers);

// jsdom doesn't implement ResizeObserver, which Radix's Select needs just to mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom doesn't implement the Pointer Capture APIs or scrollIntoView, both of which Radix's
// Select uses internally when handling option clicks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

// jsdom doesn't implement matchMedia either, needed by ThemeToggle and shadcn's
// use-mobile hook (used internally by the sidebar).
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
