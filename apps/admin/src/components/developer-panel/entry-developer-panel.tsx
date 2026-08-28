import { useState } from 'react';
import { Code2 } from 'lucide-react';

import { API_URL } from '@/lib/api-client';
import { getOpenApiOperation, useOpenApiDoc } from '@/lib/queries/openapi';
import type { ContentType, Entry } from '@/lib/types';
import { CodeBlock } from '@/components/code-block';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { EndpointRow } from './endpoint-row';
import { buildEntrySnippets } from './generate-snippets';
import { LANGUAGE_TABS } from './language-tabs';

const GET_PATH_TEMPLATE = '/api/v1/public/{contentType}/{slug}';

export function EntryDeveloperPanel({ contentType, entry }: { contentType: ContentType; entry: Entry }) {
  const [open, setOpen] = useState(false);
  const { data: openApiDoc } = useOpenApiDoc(open);
  const getOperation = getOpenApiOperation(openApiDoc, GET_PATH_TEMPLATE, 'get');

  const path = `/api/v1/public/${contentType.slug}/${entry.slug}`;
  const snippets = buildEntrySnippets({ apiUrl: API_URL, contentType, entrySlug: entry.slug });
  const isPublished = entry.status === 'published';

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <Code2 />
          Developer
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-hidden data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <Code2 className="size-4" />
            Developer
          </SheetTitle>
          <SheetDescription>
            How to fetch this exact entry ("{entry.slug}") from a frontend.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">API endpoint</h3>
            <EndpointRow
              method="GET"
              path={path}
              summary={getOperation?.summary}
              note={
                isPublished
                  ? undefined
                  : "This entry is a draft — this endpoint 404s until it's published, indistinguishable from a slug that doesn't exist."
              }
            />
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Response</h3>
              <StatusBadge status={entry.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {isPublished
                ? "This entry's actual current data."
                : 'This is the data the endpoint will return once published.'}
            </p>
            <CodeBlock label="JSON" code={JSON.stringify(entry, null, 2)} />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Consume with</h3>
            <Tabs defaultValue="astro">
              <TabsList className="flex-wrap">
                {LANGUAGE_TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {LANGUAGE_TABS.map((tab) => (
                <TabsContent key={tab.value} value={tab.value}>
                  <CodeBlock label={tab.label} code={snippets[tab.value]} />
                </TabsContent>
              ))}
            </Tabs>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
