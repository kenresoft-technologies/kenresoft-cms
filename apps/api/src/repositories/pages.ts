import { and, desc, eq, lte, pages, pageRevisions } from '@kenresoft-cms/database';
import { doesRoutePatternMatchLiteralRoute } from '@kenresoft-cms/contracts';
import type { Database, EntryStatus, NewPage, Page, PageRevision } from '@kenresoft-cms/database';

type PageWriteInput = {
  route?: NewPage['route'] | undefined;
  title?: NewPage['title'] | undefined;
  status?: NewPage['status'] | undefined;
  blocks?: NewPage['blocks'] | undefined;
  seo?: NewPage['seo'] | undefined;
  publishAt?: NewPage['publishAt'] | undefined;
};

async function snapshotPageRevision(
  db: Database,
  page: Pick<Page, 'id' | 'title' | 'status' | 'blocks' | 'seo'>,
  createdBy: string | null,
): Promise<void> {
  await db.insert(pageRevisions).values({
    pageId: page.id,
    title: page.title,
    status: page.status,
    blocks: page.blocks,
    seo: page.seo,
    createdBy,
  });
}

export async function createPage(
  db: Database,
  input: Pick<NewPage, 'route' | 'title' | 'blocks'> & Pick<PageWriteInput, 'status' | 'seo' | 'publishAt'>,
  createdBy: string | null,
): Promise<Page> {
  const [page] = await db.insert(pages).values({ ...input, createdBy }).returning();
  await snapshotPageRevision(db, page!, createdBy);
  return page!;
}

export function listPages(db: Database, status?: EntryStatus): Promise<Page[]> {
  return db.query.pages.findMany({
    where: status ? eq(pages.status, status) : undefined,
    orderBy: desc(pages.updatedAt),
  });
}

export function listPublishedPages(db: Database): Promise<Page[]> {
  return db.query.pages.findMany({
    where: eq(pages.status, 'published'),
    orderBy: desc(pages.updatedAt),
  });
}

export function getPageById(db: Database, id: string): Promise<Page | undefined> {
  return db.query.pages.findFirst({ where: eq(pages.id, id) });
}

export function getPageByRoute(db: Database, route: string): Promise<Page | undefined> {
  return db.query.pages.findFirst({ where: eq(pages.route, route) });
}

// Public content API (§4.2) — a draft matching the requested route 404s exactly like a route
// that doesn't exist at all, the same convention getPublishedEntryBySlug already establishes.
export function getPublishedPageByRoute(db: Database, route: string): Promise<Page | undefined> {
  return db.query.pages.findFirst({
    where: and(eq(pages.route, route), eq(pages.status, 'published')),
  });
}

// Route-collision check, the Pages-side half of §4.3/§16: does any content-type routePattern
// swallow this literal route? A full scan of pages is fine at this scale — a website's page
// count is small, and this codebase already accepts equivalent full scans elsewhere (e.g.
// listContentTypes' own unfiltered findMany).
export async function findPageMatchingRoutePattern(db: Database, routePattern: string): Promise<Page | undefined> {
  const allPages = await db.query.pages.findMany();
  return allPages.find((page) => doesRoutePatternMatchLiteralRoute(routePattern, page.route));
}

// Snapshots the page's current (about-to-be-overwritten) state as a revision before applying
// the update, so there's always something to restore to (§3.2) — exact mirror of
// repositories/entries.ts's updateEntry.
export async function updatePage(
  db: Database,
  id: string,
  input: PageWriteInput,
  updatedBy: string | null,
): Promise<Page | undefined> {
  const current = await db.query.pages.findFirst({ where: eq(pages.id, id) });
  if (!current) return undefined;

  await snapshotPageRevision(db, current, updatedBy);

  const [page] = await db
    .update(pages)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(pages.id, id))
    .returning();
  return page;
}

export async function deletePage(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db.delete(pages).where(eq(pages.id, id)).returning({ id: pages.id });
  return Boolean(deleted);
}

export function listPageRevisions(db: Database, pageId: string): Promise<PageRevision[]> {
  return db.query.pageRevisions.findMany({
    where: eq(pageRevisions.pageId, pageId),
    orderBy: desc(pageRevisions.createdAt),
  });
}

// Reuses updatePage so the restore itself snapshots the pre-restore state too — restoring is
// never a dead end, same reasoning as restoreEntryRevision.
export async function restorePageRevision(
  db: Database,
  pageId: string,
  revisionId: string,
  restoredBy: string | null,
): Promise<Page | undefined> {
  const revision = await db.query.pageRevisions.findFirst({
    where: and(eq(pageRevisions.id, revisionId), eq(pageRevisions.pageId, pageId)),
  });
  if (!revision) return undefined;

  return updatePage(
    db,
    pageId,
    { title: revision.title, status: revision.status, blocks: revision.blocks, seo: revision.seo },
    restoredBy,
  );
}

// Scanned by the same scheduled-publishing Cron Trigger as publishDueEntries (§3.1/§13) — goes
// through updatePage (createdBy: null, no user initiated this) so each auto-publish is itself
// snapshotted as a revision.
export async function publishDuePages(db: Database): Promise<Page[]> {
  const due = await db.query.pages.findMany({
    where: and(eq(pages.status, 'draft'), lte(pages.publishAt, new Date())),
  });

  const published: Page[] = [];
  for (const page of due) {
    const updated = await updatePage(db, page.id, { status: 'published' }, null);
    if (updated) published.push(updated);
  }
  return published;
}
