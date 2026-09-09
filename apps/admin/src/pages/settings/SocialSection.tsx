import { Share2 } from 'lucide-react';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Social links and contact info used to live here as dedicated Settings fields
// (contactEmail/socialLinks) — removed because they had no public route of their own and fully
// duplicated what Global Variables already does, with a more rigid, fixed-shape schema and no
// way for a frontend to actually read them. Global Variables is the intended long-term home for
// this kind of public site config (docs/ASTRO.md's "Where public site config lives"):
// unauthenticated, edge-cached, arbitrary key names, and already has a "Site Info" template
// (Global Variables page → Examples) covering exactly this — contact email, phone, and social
// links. Existing contactEmail/socialLinks values were migrated into Global Variables
// automatically (migration 0024) rather than dropped.
export function SocialSection() {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-lg">Social &amp; contact info</CardTitle>
        <CardDescription>This moved to Global Variables.</CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-10 text-center">
          <Share2 className="size-8 text-muted-foreground" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Social links and a contact email now live in Global Variables — free-form key/value
            pairs any frontend can read from the public API. Use the "Site Info" template there to
            add contact/social fields in one step.
          </p>
          <Button type="button" variant="outline" onClick={() => void navigate('/global-variables')}>
            Go to Global Variables
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
