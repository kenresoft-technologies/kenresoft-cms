export const ENTRY_STATUSES = ['draft', 'published'] as const;

export type EntryStatus = (typeof ENTRY_STATUSES)[number];
