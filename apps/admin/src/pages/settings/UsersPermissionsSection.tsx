import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// User/role management already has its own full page (Users, owner-gated role changes) —
// this section is a pointer to it plus an accurate description of the role model, not a
// duplicate of that page's logic.
export function UsersPermissionsSection() {
  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-lg">Users &amp; permissions</CardTitle>
        <CardDescription>Who can access this deployment and what they can do.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-2">
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            Kenresoft CMS has two roles: <span className="font-medium text-foreground">owner</span> and{' '}
            <span className="font-medium text-foreground">editor</span>. The first person to sign up on a
            deployment becomes its owner; everyone after defaults to editor.
          </p>
          <p>
            Owners can create content types and forms, change other users&apos; roles, add or remove users, and
            edit these settings. Editors can manage entries, media, and form submissions, but can&apos;t change
            structure, roles, or the user list.
          </p>
        </div>
        <div>
          <Button asChild variant="outline" size="sm">
            <Link to="/users">
              Manage users
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
