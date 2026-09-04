import { swatchClasses } from '@/lib/accent-color';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

// A colored content-type "tag" (Strapi's Content Manager does this so entries from different
// collections stay scannable in one list) — used both on the content types table and the
// cross-content-type entries view.
export function ContentTypeBadge({
  id,
  name,
  className,
}: {
  id: string;
  name: string;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn('font-medium', swatchClasses(id), className)}>
      {name}
    </Badge>
  );
}
