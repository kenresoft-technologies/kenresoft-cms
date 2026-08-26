import { ArrowRight, LayoutList } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to Kenresoft CMS.</p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <LayoutList className="size-5 text-primary" />
          </div>
          <CardTitle>Start with a content type</CardTitle>
          <CardDescription>
            Content types are the top-level building block for this deployment (§11) — define
            one, add fields to it, then start creating entries.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/content-types">
              Go to content types
              <ArrowRight />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
