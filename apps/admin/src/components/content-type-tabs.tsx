import { useNavigate } from 'react-router';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Shared between EntriesPage and ContentTypeDetailPage (the schema/fields editor) — the two
// halves of a content type's detail view. Entries is the default/primary tab (clicking a
// content type card goes there directly); Schema is one click away rather than a separate
// route three segments deep. A plain onValueChange navigation (not TabsTrigger asChild + Link)
// keeps click and keyboard activation both routing through the same one navigate() call.
export function ContentTypeTabs({
  contentTypeId,
  active,
}: {
  contentTypeId: string;
  active: 'entries' | 'schema';
}) {
  const navigate = useNavigate();

  return (
    <Tabs
      value={active}
      onValueChange={(value) => {
        navigate(value === 'schema' ? `/content-types/${contentTypeId}/schema` : `/content-types/${contentTypeId}`);
      }}
    >
      <TabsList>
        <TabsTrigger value="entries">Entries</TabsTrigger>
        <TabsTrigger value="schema">Schema</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
