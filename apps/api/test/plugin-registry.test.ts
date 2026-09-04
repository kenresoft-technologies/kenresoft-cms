import { PLUGIN_SDK_VERSION } from '@kenresoft-cms/plugin-sdk';
import type { PluginManifest, PluginRegistration } from '@kenresoft-cms/plugin-sdk';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { PluginRegistryError, validatePlugins } from '../src/plugins/registry';

// validatePlugins is deliberately pure (no reliance on the real @kenresoft-cms/plugin-hello
// import), so every failure mode here is exercised against a throwaway, fabricated plugin list —
// never the real one apps/api/src/plugins/registry.ts's own VALIDATED_PLUGINS constant resolves
// at module-load. This only covers what's decided at cold start (manifest shape/sdkVersion/
// duplicate ids) — whether a validated plugin is actually *enabled* is a live, DB-backed,
// per-request question now, covered by test/plugin-enablement.test.ts instead.
function fakeRegistration(manifest: PluginManifest): PluginRegistration {
  return { manifest, routes: new Hono() };
}

const validManifest: PluginManifest = {
  id: 'fake',
  name: 'Fake',
  version: '0.1.0',
  sdkVersion: PLUGIN_SDK_VERSION,
};

describe('validatePlugins', () => {
  it('returns every plugin whose manifest is valid', () => {
    const validated = validatePlugins([fakeRegistration(validManifest)]);
    expect(validated).toHaveLength(1);
    expect(validated[0]!.manifest.id).toBe('fake');
  });

  it('throws on a duplicate plugin id', () => {
    expect(() => validatePlugins([fakeRegistration(validManifest), fakeRegistration(validManifest)])).toThrow(
      PluginRegistryError,
    );
  });

  it('throws on a malformed manifest (invalid id format)', () => {
    const malformed = { ...validManifest, id: 'Not-Valid-ID!' };
    expect(() => validatePlugins([fakeRegistration(malformed)])).toThrow(PluginRegistryError);
  });

  it('throws on an unsupported sdkVersion', () => {
    const wrongVersion = { ...validManifest, sdkVersion: '99.0.0' };
    expect(() => validatePlugins([fakeRegistration(wrongVersion)])).toThrow(PluginRegistryError);
  });
});
