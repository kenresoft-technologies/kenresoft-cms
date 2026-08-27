import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

function getStoredPreference(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function getSystemIsDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function subscribeToSystemTheme(callback: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

interface ThemeContextValue {
  preference: ThemePreference;
  isDark: boolean;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Lifted out of the old per-icon-button local state so the top-bar toggle and the Settings ›
// Appearance section stay in sync — both mounted at once inside AppLayout, so two independent
// useState copies would drift the moment one of them changed. `isDark` is derived on every
// render from `preference` plus a useSyncExternalStore subscription to the OS theme (rather
// than mirrored into its own useState via an effect), so a live OS theme change under
// preference: 'system' updates the UI without a setState-in-effect cascade. index.html has its
// own inline pre-hydration copy of this resolution logic (avoids a flash of the wrong theme
// before React mounts) — keep the two in sync if this logic ever changes.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(getStoredPreference);
  const systemIsDark = useSyncExternalStore(subscribeToSystemTheme, getSystemIsDark, () => false);
  const isDark = preference === 'system' ? systemIsDark : preference === 'dark';

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, isDark, setPreference }),
    [preference, isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
