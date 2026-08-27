import { Laptop, Moon, Sun } from 'lucide-react';

import { useTheme, type ThemePreference } from '@/lib/theme';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Laptop },
];

// Theme is a per-browser preference (localStorage, not the Settings table) — it applies
// immediately and isn't gated by role, unlike every other section here.
export function AppearanceSection() {
  const { preference, setPreference } = useTheme();

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-lg">Appearance</CardTitle>
        <CardDescription>How the admin looks on this device. Applies immediately.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-2">
        <Label>Theme</Label>
        <div role="radiogroup" aria-label="Theme" className="flex gap-2">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={preference === option.value}
              onClick={() => setPreference(option.value)}
              className={cn(
                'flex flex-1 flex-col items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors',
                preference === option.value
                  ? 'border-primary bg-primary/5 font-medium text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <option.icon className="size-4" />
              {option.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
