import { swatchClasses } from '@/lib/accent-color';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

// Shared rendering for every deterministic colored pill in the admin (content types, forms) —
// the same id always gets the same color via swatchClasses' hash. ContentTypeBadge/FormBadge
// are thin, semantically-named wrappers over this so call sites read as what they show.
export function ColorBadge({
  id,
  label,
  className,
}: {
  id: string;
  label: string;
  // `| undefined`, not just `?`, so callers forwarding their own optional className prop through
  // (ContentTypeBadge/FormBadge) type-check under this project's exactOptionalPropertyTypes.
  className?: string | undefined;
}) {
  return (
    <Badge variant="outline" className={cn('font-medium', swatchClasses(id), className)}>
      {label}
    </Badge>
  );
}
