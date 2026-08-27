import { Moon, Sun } from 'lucide-react';

import { useTheme } from '@/lib/theme';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { isDark, setPreference } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setPreference(isDark ? 'light' : 'dark')}
      aria-label="Toggle theme"
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
