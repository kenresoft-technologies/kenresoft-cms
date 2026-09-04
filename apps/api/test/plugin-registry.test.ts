import { PLUGIN_SDK_VERSION } from '@kenresoft-cms/plugin-sdk';
import type { PluginManifest, PluginRegistration } from '@kenresoft-cms/plugin-sdk';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { PluginRegistryError, resolvePlugins } from '../src/plugins/registry';

// resolvePlugins is deliberately pure (no reliance on the real static config or the real
// @kenresoft-cms/plugin-hello import), so every failure mode here is exercised against a
// throwaway, fabricated plugin list — never the real one apps/api/src/plugins/registry.ts's own
// ENABLED_PLUGINS constant resolves at module-load.
function fakeRegistration(manifest: PluginManifest): PluginRegistration {
  return { manifest, routes: new Hono() };
}

const validManifest: PluginManifest = {
  id: 'fake',
  name: 'Fake',
  version: '0.1.0',
  sdkVersion: PLUGIN_SDK_VERSION,
};

describe('resolvePlugins', () => {
  it('enables a valid plugin whose config marks it enabled', () => {
    const enabled = resolvePlugins([fakeRegistration(validManifest)], { fake: { enabled: true } });
    expect(enabled).toHaveLength(1);
    expect(enabled[0]!.manifest.id).toBe('fake');
  });

  it('excludes a valid plugin whose config marks it disabled, or that has no config entry at all', () => {
    expect(resolvePlugins([fakeRegistration(validManifest)], { fake: { enabled: false } })).toHaveLength(0);
    expect(resolvePlugins([fakeRegistration(validManifest)], {})).toHaveLength(0);
  });

  it('throws on a duplicate plugin id, even if only one is enabled', () => {
    expect(() =>
      resolvePlugins([fakeRegistration(validManifest), fakeRegistration(validManifest)], { fake: { enabled: true } }),
    ).toThrow(PluginRegistryError);
  });

  it('throws on a malformed manifest (invalid id format)', () => {
    const malformed = { ...validManifest, id: 'Not-Valid-ID!' };
    expect(() => resolvePlugins([fakeRegistration(malformed)], { 'Not-Valid-ID!': { enabled: true } })).toThrow(
      PluginRegistryError,
    );
  });

  it('throws on an unsupported sdkVersion', () => {
    const wrongVersion = { ...validManifest, sdkVersion: '99.0.0' };
    expect(() => resolvePlugins([fakeRegistration(wrongVersion)], { fake: { enabled: true } })).toThrow(
      PluginRegistryError,
    );
  });

  it('throws when an enabled plugin depends on one that is not enabled', () => {
    const dependent: PluginManifest = { ...validManifest, id: 'dependent', dependencies: { fake: '*' } };
    expect(() =>
      resolvePlugins([fakeRegistration(dependent)], { dependent: { enabled: true } }),
    ).toThrow(PluginRegistryError);
  });

  it('allows an enabled plugin whose dependency is also enabled', () => {
    const dependent: PluginManifest = { ...validManifest, id: 'dependent', dependencies: { fake: '*' } };
    const enabled = resolvePlugins([fakeRegistration(validManifest), fakeRegistration(dependent)], {
      fake: { enabled: true },
      dependent: { enabled: true },
    });
    expect(enabled.map((registration) => registration.manifest.id).sort()).toEqual(['dependent', 'fake']);
  });
});
