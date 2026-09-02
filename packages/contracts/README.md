# @kenresoft-cms/contracts

Zod schemas and shared TypeScript types for the [Kenresoft CMS](https://github.com/kenresoft-technologies/kenresoft-cms) API — the same contract used by the API Worker's request/response validation and the Admin Worker's UI. Published so the Admin Worker can be installed as a standalone Cloudflare Worker without checking out the full monorepo.

This package is a component of Kenresoft CMS and is not meant to be used as a general-purpose, standalone library outside of it — its schemas track that project's API surface directly and will change without a stability guarantee independent of it.

```ts
import { ROLE_RANK, roleAtLeast } from '@kenresoft-cms/contracts/schemas/enums';
```

See the [main repository](https://github.com/kenresoft-technologies/kenresoft-cms) for documentation.
