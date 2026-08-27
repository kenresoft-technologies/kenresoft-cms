import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type StatusTone = 'success' | 'info' | 'neutral' | 'muted';

// Covers every status string used across the admin today: entry/revision status
// (draft/published) and form submission status (new/read/archived). An unknown status still
// renders — just as a neutral badge with its raw value as the label — rather than crashing.
const STATUS_CONFIG: Record<string, { label: string; tone: StatusTone }> = {
  published: { label: 'Published', tone: 'success' },
  draft: { label: 'Draft', tone: 'neutral' },
  new: { label: 'New', tone: 'info' },
  read: { label: 'Read', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'muted' },
};

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'border-success/25 bg-success/12 text-success dark:bg-success/20',
  info: 'border-primary/25 bg-primary/10 text-primary',
  neutral: 'border-border bg-secondary text-secondary-foreground',
  muted: 'border-border bg-muted text-muted-foreground',
};

const DOT_CLASSES: Record<StatusTone, string> = {
  success: 'bg-success',
  info: 'bg-primary',
  neutral: 'bg-foreground/50',
  muted: 'bg-muted-foreground/50',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, tone: 'neutral' as StatusTone };

  return (
    <Badge variant="outline" className={cn('gap-1.5 font-medium', TONE_CLASSES[config.tone], className)}>
      <span className={cn('size-1.5 rounded-full', DOT_CLASSES[config.tone])} />
      {config.label}
    </Badge>
  );
}
