import { useState } from 'react';
import { Code2 } from 'lucide-react';

import { API_URL } from '@/lib/api-client';
import { getOpenApiOperation, useOpenApiDoc } from '@/lib/queries/openapi';
import type { ContentType, FieldDefinition } from '@/lib/types';
import { CodeBlock } from '@/components/code-block';
import { FieldTypeBadge } from '@/components/field-type-badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { EndpointRow } from './endpoint-row';
import { buildDeveloperSnippets, buildExampleEntry } from './generate-snippets';
import { LANGUAGE_TABS } from './language-tabs';

// The two public content routes always exist for every content type — see
// apps/api/src/routes/public/content.ts — so their path templates are stable literals, not a
// hand-maintained registry. Endpoint summaries/descriptions still come from the live OpenAPI
// document (§16) rather than being duplicated here, so route-level doc changes show up
// automatically.
const LIST_PATH_TEMPLATE = '/api/v1/public/{contentType}';
const GET_PATH_TEMPLATE = '/api/v1/public/{contentType}/{slug}';

export function ContentTypeDeveloperPanel({
  contentType,
  fields,
}: {
  contentType: ContentType;
  fields: FieldDefinition[];
}) {
  const [open, setOpen] = useState(false);
  // Only fetched once the panel is actually opened — no reason to pull the full OpenAPI
  // document on every content-type page load.
  const { data: openApiDoc } = useOpenApiDoc(open);
  const listOperation = getOpenApiOperation(openApiDoc, LIST_PATH_TEMPLATE, 'get');
  const getOperation = getOpenApiOperation(openApiDoc, GET_PATH_TEMPLATE, 'get');

  const listPath = `/api/v1/public/${contentType.slug}`;
  const getPath = `/api/v1/public/${contentType.slug}/your-entry-slug`;
  const exampleEntry = buildExampleEntry(contentType, fields);
  const snippets = buildDeveloperSnippets({ apiUrl: API_URL, contentType, fields });

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
            Everything needed to consume "{contentType.name}" from a frontend, generated from
            this content type's own fields and API contract.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">API endpoints</h3>
            <EndpointRow method="GET" path={listPath} summary={listOperation?.summary} />
            <EndpointRow
              method="GET"
              path={getPath}
              summary={getOperation?.summary}
              note="404s exactly the same way for a draft entry as for a slug that doesn't exist."
            />
            <p className="text-xs text-muted-foreground">
              Responses are cached at the edge for up to 5 minutes and invalidated immediately on
              publish, edit, or delete.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Fields</h3>
            {fields.length > 0 ? (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Required</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map((field) => (
                      <TableRow key={field.id}>
                        <TableCell className="font-mono text-sm">{field.name}</TableCell>
                        <TableCell>
                          <FieldTypeBadge fieldType={field.fieldType} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">{field.required ? 'Yes' : 'No'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This content type has no fields yet — add one to see it reflected here.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Example response</h3>
            <p className="text-xs text-muted-foreground">
              Generated from this content type's fields, not a live entry.
            </p>
            <CodeBlock label="JSON" code={JSON.stringify(exampleEntry, null, 2)} />
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
