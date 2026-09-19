# Raw HTML block — security model

The Site Builder's **Raw HTML** block lets an admin paste HTML into a page. Because that HTML is
published to every visitor of the public site, it is treated as untrusted input at every step, even
though an admin wrote it (an admin account can be compromised, or the pasted markup can come from
somewhere untrusted).

## Safeguards

1. **Off by default.** Nothing can be added until an admin turns on *Settings → API → Raw HTML
   blocks* (`Settings.featureFlags.rawHtmlBlocks`). Every switch is recorded in the audit log.
2. **Admin/owner only.** Only `admin` and `owner` can add or change a Raw HTML block (pages,
   templates, and restoring a revision that contains one). An editor may still edit the rest of a
   page that already contains an unchanged raw block. Enforced on the server
   (`apps/api/src/lib/raw-html-guard.ts`); the UI merely hides what would be refused.
3. **Sanitized on every write.** `apps/api/src/lib/raw-html-sanitizer.ts` keeps an allow-list of
   layout/text tags and attributes and drops everything else:
   - no `script`, `style`, `iframe`, `object`, `embed`, `form`/`input`, `svg`, `math`, `link`, `meta`,
     `base`, media elements — dangerous elements are removed **with their content**
   - no event handlers (`on*`), `id`/`name` (DOM clobbering), `srcdoc`, unknown attributes
   - links: `http`, `https`, `mailto`, relative only; `javascript:`/`data:`/`vbscript:` removed,
     including tab/newline obfuscation and entity-encoded schemes (`&colon;`, `&#115;`)
   - images: `http(s)` or relative only (no `data:`)
   - inline `style` limited to a property allow-list; no `position`, `z-index`, `transform`,
     `url()`, `expression()`, or negative offsets (no overlays or clickjacking)
   - tags are balanced so a block can't break out of, or swallow, its container
   - sanitizing is idempotent, so re-saving unchanged content never mutates it
4. **Sanitized again on every public read** (defense in depth), and the feature flag is checked
   live: **turning the feature off immediately hides every raw block** from the public API. Cached
   pages are purged when the flag changes.
5. **Sandboxed admin preview.** The editor shows the *server-sanitized* result in an `<iframe
   sandbox="">` with its own CSP (no scripts, no same-origin), so what you preview is what is
   published, and nothing pasted can run in the admin.
6. **Audit trail.** `page.raw_html_changed`, `settings.raw_html_enabled` and
   `settings.raw_html_disabled` are recorded.

## For frontend developers

Render raw blocks only from the public API's output. The Astro example does so with `set:html` in
`RawHtmlBlock.astro`. If you write your own frontend, also consider a Content-Security-Policy on
your site as a second layer — the CMS cannot enforce headers on a site it doesn't serve. A sensible
starting point for a site that renders CMS HTML (adjust the image host to where your media is
served):

```
Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; img-src 'self' https: data:
```

Rich text blocks and entry `rich_text` fields are sanitized by the API with the same sanitizer, so
the same rule applies to them: render the public API's output, never a stored copy.

## Known limits

- The sanitizer is a small dependency-free tokenizer (no npm HTML parser runs in the Workers
  runtime used here). It is deliberately conservative: valid-but-unusual markup may be simplified or
  dropped rather than risk letting something through.
- Email: the normal Message format uses a strict rich-text sanitizer. Designed templates go through
  the separate **Design HTML** mode on the Email page (admin/owner only), which uses an email preset
  of the same sanitizer: table layout, inline styles and https images are kept; scripts, forms,
  `<style>` blocks, relative links and `data:` images are removed.
