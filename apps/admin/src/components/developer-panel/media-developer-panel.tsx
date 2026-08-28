import { useState } from 'react';
import { Code2 } from 'lucide-react';

import { publicMediaFileUrl } from '@/lib/queries/media';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Media } from '@/lib/types';
import { CodeBlock } from '@/components/code-block';
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

const MEDIA_TABS = [
  { value: 'html', label: 'HTML' },
  { value: 'astro', label: 'Astro' },
  { value: 'curl', label: 'cURL' },
] as const;

export function MediaDeveloperPanel({ item, className }: { item: Media; className?: string }) {
  const [open, setOpen] = useState(false);
  const url = publicMediaFileUrl(item.id);
  const alt = item.altText ?? item.filename;
  const hasDimensions = Boolean(item.width && item.height);

  const html = `<img\n  src="${url}"\n  alt="${alt}"\n${hasDimensions ? `  width="${item.width}"\n  height="${item.height}"\n` : ''}/>`;

  const astro = `import { createKenresoftClient } from '@kenresoft/astro';

const cms = createKenresoftClient({ url: import.meta.env.PUBLIC_CMS_URL });
const src = cms.media.url({ id: '${item.id}' });`;

  const astroTemplate = `<img src={src} alt="${alt}" ${hasDimensions ? `width={${item.width}} height={${item.height}} ` : ''}/>`;

  const curl = `curl -o '${item.filename}' '${url}'`;

  const snippets: Record<(typeof MEDIA_TABS)[number]['value'], string> = {
    html,
    astro: `${astro}\n\n${astroTemplate}`,
    curl,
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={`Developer info for ${item.filename}`}
          className={cn(className)}
        >
          <Code2 />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-hidden data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <Code2 className="size-4" />
            Developer
          </SheetTitle>
          <SheetDescription>How to reference "{item.filename}" from a frontend.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Public URL</h3>
            <CodeBlock label="URL" code={url} />
          </section>

          <section className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">MIME type</span>
              <span className="font-mono">{item.contentType}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Size</span>
              <span>{formatBytes(item.size)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Dimensions</span>
              <span>{hasDimensions ? `${item.width}×${item.height}` : 'Not available'}</span>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Use it</h3>
            <Tabs defaultValue="html">
              <TabsList>
                {MEDIA_TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {MEDIA_TABS.map((tab) => (
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
