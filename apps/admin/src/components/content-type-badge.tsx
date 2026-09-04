import { ColorBadge } from '@/components/color-badge';

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
  return <ColorBadge id={id} label={name} className={className} />;
}
