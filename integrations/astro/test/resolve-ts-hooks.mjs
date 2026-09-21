// Node's type-stripping test runner doesn't resolve extensionless relative imports
// (`from './auth'`), which is how src/ is written (it's compiled by tsc, not run directly).
// This hook retries a failed relative specifier with a `.ts` suffix so tests can import
// src/index.ts — the real public entry point — instead of only the leaf modules.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
