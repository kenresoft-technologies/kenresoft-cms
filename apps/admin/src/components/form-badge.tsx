import { ColorBadge } from '@/components/color-badge';

// A colored form "tag" — same purpose as ContentTypeBadge, for the Forms table and the
// cross-form Submissions view.
export function FormBadge({ id, name, className }: { id: string; name: string; className?: string }) {
  return <ColorBadge id={id} label={name} className={className} />;
}
