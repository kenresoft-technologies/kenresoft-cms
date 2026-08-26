// Local response shapes for the admin API — timestamps are strings over the wire, unlike
// packages/database's Date-typed columns, so these are intentionally not shared with the
// backend. Phase 6 (docs/ARCHITECTURE.md §20) replaces this with generated contract types.
export interface Project {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}
