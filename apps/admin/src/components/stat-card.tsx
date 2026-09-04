import type { LucideIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

// Used sparingly (Payload's restrained one-accent-color style) — most stats stay primary, only
// a stat this pass gives real extra context to (e.g. Media, once Storage Usage exists) gets
// the secondary tone, rather than a different color per card.
const TONE_CLASSES = {
  primary: { chip: 'bg-primary/10', icon: 'text-primary' },
  success: { chip: 'bg-success/12', icon: 'text-success' },
} as const;

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'primary',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof TONE_CLASSES;
}) {
  const toneClasses = TONE_CLASSES[tone];

  return (
    <Card>
      <CardContent className="flex items-start gap-3">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${toneClasses.chip}`}>
          <Icon className={`size-5 ${toneClasses.icon}`} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          {hint ? <p className="truncate text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
