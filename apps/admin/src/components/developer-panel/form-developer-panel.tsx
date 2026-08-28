import { useState } from 'react';
import { Code2 } from 'lucide-react';

import { API_URL } from '@/lib/api-client';
import { getOpenApiOperation, useOpenApiDoc } from '@/lib/queries/openapi';
import type { Form, FormField } from '@/lib/types';
import { CodeBlock } from '@/components/code-block';
import { FieldTypeBadge } from '@/components/field-type-badge';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { EndpointRow } from './endpoint-row';
import { buildExampleFormSubmission, buildFormSnippets } from './generate-form-snippets';
import { LANGUAGE_TABS } from './language-tabs';

const SUBMIT_PATH_TEMPLATE = '/api/v1/public/forms/{slug}/submissions';

export function FormDeveloperPanel({ form, fields }: { form: Form; fields: FormField[] }) {
  const [open, setOpen] = useState(false);
  const { data: openApiDoc } = useOpenApiDoc(open);
  const submitOperation = getOpenApiOperation(openApiDoc, SUBMIT_PATH_TEMPLATE, 'post');

  const path = `/api/v1/public/forms/${form.slug}/submissions`;
  const exampleSubmission = buildExampleFormSubmission(form, fields);
  const snippets = buildFormSnippets({ apiUrl: API_URL, form, fields });

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
            How to submit "{form.name}" from a frontend, generated from this form's own fields.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">API endpoint</h3>
            <EndpointRow method="POST" path={path} summary={submitOperation?.summary} />
            <p className="text-xs text-muted-foreground">
              Rate limited to 5 submissions per minute per visitor. String values are sanitized
              (every {'<'}/{'>'} character is stripped) and validated dynamically against the
              fields below.
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
                This form has no fields yet — add one to see it reflected here.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Example response</h3>
            <p className="text-xs text-muted-foreground">
              Generated from this form's fields, not a live submission.
            </p>
            <CodeBlock label="JSON" code={JSON.stringify(exampleSubmission, null, 2)} />
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
