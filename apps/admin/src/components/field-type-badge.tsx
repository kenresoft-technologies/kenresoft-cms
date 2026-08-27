import {
  AlignLeft,
  Calendar,
  Circle,
  Clock,
  FileText,
  Globe,
  Hash,
  Image,
  Link,
  Link2,
  List,
  ListChecks,
  Mail,
  SquareCheck,
  ToggleLeft,
  Type,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';

// Shared between the content-type field builder and the form field builder — both domains
// draw from overlapping FieldType/FormFieldType string unions (see packages/contracts/schemas/
// enums.ts), so one label+icon map covers both rather than duplicating it per page.
const FIELD_TYPE_ICONS: Record<string, LucideIcon> = {
  text: Type,
  textarea: AlignLeft,
  rich_text: FileText,
  number: Hash,
  boolean: ToggleLeft,
  checkbox: SquareCheck,
  date: Calendar,
  datetime: Clock,
  slug: Link2,
  email: Mail,
  url: Globe,
  select: List,
  multi_select: ListChecks,
  media: Image,
  reference: Link,
};

export function fieldTypeIcon(fieldType: string): LucideIcon {
  return FIELD_TYPE_ICONS[fieldType] ?? Circle;
}

export function FieldTypeBadge({ fieldType, className }: { fieldType: string; className?: string }) {
  const Icon = FIELD_TYPE_ICONS[fieldType] ?? Circle;
  return (
    <Badge variant="outline" className={className}>
      <Icon />
      {fieldType}
    </Badge>
  );
}
