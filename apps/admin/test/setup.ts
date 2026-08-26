import '@testing-library/jest-dom/vitest';

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
