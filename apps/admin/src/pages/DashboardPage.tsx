import { ArrowRight, FolderKanban } from 'lucide-react';
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
            <FolderKanban className="size-5 text-primary" />
          </div>
          <CardTitle>Start with a project</CardTitle>
          <CardDescription>
            Every content type and entry belongs to a project — the top-level boundary for a
            website or client (§11).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/projects">
              Go to projects
              <ArrowRight />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
