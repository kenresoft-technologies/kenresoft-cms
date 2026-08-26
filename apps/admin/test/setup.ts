import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement ResizeObserver, which Radix's Select needs just to mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
