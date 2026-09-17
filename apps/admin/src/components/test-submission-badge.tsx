import { FlaskConical } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

// Distinguishes a submission created through Forms' "Preview & Test" tool from a real visitor
// submission — shared by FormSubmissionsPage and AllSubmissionsPage rather than duplicated, so
// the two inboxes can never drift on how a test row looks. Deliberately its own badge, not a
// StatusBadge tone — isTest is orthogonal to new/read/archived, not a replacement for it.
export function TestSubmissionBadge() {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-500/30 bg-amber-500/10 font-medium text-amber-600 dark:text-amber-400"
    >
      <FlaskConical className="size-3" />
      Test
    </Badge>
  );
}
