# @kenresoft/astro

Typed client for a Kenresoft CMS deployment's public API — currently entry listing/retrieval
only (`entries.list`, `entries.get`). See [`docs/ASTRO.md`](../../docs/ASTRO.md) for the full
guide (usage, environment variables, static vs SSR, current limitations) and
[`examples/astro-site`](../../examples/astro-site) for a working consumer.

```ts
import { createKenresoftClient } from '@kenresoft/astro';

const cms = createKenresoftClient({ url: 'http://localhost:8787' });
const posts = await cms.entries.list({ contentType: 'blog-post' });
const post = await cms.entries.get({ contentType: 'blog-post', slug: 'hello-world' });

// A media-type field on an entry stores a Media item's id — this builds the public file URL
// for it (no fetch; use it directly as an <img src>).
const imageUrl = cms.media.url({ id: post.data.featuredImage as string });
```

Despite the package name, nothing in `src/index.ts` is Astro-specific — it's a plain
fetch-based client any JS/TS project could use. It's named and documented as Astro's path in
because Astro is this project's first-class, officially supported frontend integration
(`docs/ARCHITECTURE.md` §15); other frameworks can call the same public REST API directly.
