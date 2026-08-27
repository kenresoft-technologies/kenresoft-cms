import type { LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface ComingSoonSectionProps {
  title: string;
  icon: LucideIcon;
  description: string;
  planned: string[];
}

// Every "planned" bullet describes a real, not-yet-built capability — never a control that
// looks live but silently does nothing. Keeping the section here (instead of hiding it from
// the nav) documents the intended information architecture per the product brief, without
// pretending any of it works yet.
export function ComingSoonSection({ title, icon: Icon, description, planned }: ComingSoonSectionProps) {
  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-lg">{title}</CardTitle>
          <Badge variant="outline">Not yet available</Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-10 text-center">
          <Icon className="size-8 text-muted-foreground" />
          <p className="max-w-sm text-sm text-muted-foreground">
            This area is reserved but not implemented yet. When it ships, it will cover:
          </p>
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {planned.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
