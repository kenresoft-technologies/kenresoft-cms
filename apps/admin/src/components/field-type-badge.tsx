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
  Paperclip,
  SquareCheck,
  ToggleLeft,
  Type,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
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
  file: Paperclip,
};

// A Strapi-Content-Type-Builder-style visual grouping — each field-type family gets one of the
// swatch tokens (index.css) so the field list reads as categorized at a glance, rather than
// every type sharing one uniform outline badge.
const FIELD_TYPE_TONE: Record<string, string> = {
  text: 'text-swatch-1',
  textarea: 'text-swatch-1',
  rich_text: 'text-swatch-1',
  slug: 'text-swatch-1',
  email: 'text-swatch-1',
  url: 'text-swatch-1',
  number: 'text-swatch-4',
  boolean: 'text-swatch-4',
  checkbox: 'text-swatch-4',
  date: 'text-swatch-5',
  datetime: 'text-swatch-5',
  select: 'text-swatch-3',
  multi_select: 'text-swatch-3',
  media: 'text-swatch-2',
  reference: 'text-swatch-2',
  file: 'text-swatch-6',
};

export function fieldTypeIcon(fieldType: string): LucideIcon {
  return FIELD_TYPE_ICONS[fieldType] ?? Circle;
}

export function FieldTypeBadge({ fieldType, className }: { fieldType: string; className?: string }) {
  const Icon = FIELD_TYPE_ICONS[fieldType] ?? Circle;
  return (
    <Badge variant="outline" className={cn(FIELD_TYPE_TONE[fieldType], className)}>
      <Icon />
      {fieldType}
    </Badge>
  );
}
