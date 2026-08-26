import { relations } from 'drizzle-orm';

import { projects } from './projects';
import { contentTypes } from './content-types';
import { fieldDefinitions } from './field-definitions';
import { entries } from './entries';
import { entryRevisions } from './entry-revisions';

export const projectsRelations = relations(projects, ({ many }) => ({
  contentTypes: many(contentTypes),
  entries: many(entries),
}));

export const contentTypesRelations = relations(contentTypes, ({ one, many }) => ({
  project: one(projects, { fields: [contentTypes.projectId], references: [projects.id] }),
  fields: many(fieldDefinitions),
  entries: many(entries),
}));

export const fieldDefinitionsRelations = relations(fieldDefinitions, ({ one }) => ({
  contentType: one(contentTypes, {
    fields: [fieldDefinitions.contentTypeId],
    references: [contentTypes.id],
  }),
}));

export const entriesRelations = relations(entries, ({ one, many }) => ({
  project: one(projects, { fields: [entries.projectId], references: [projects.id] }),
  contentType: one(contentTypes, {
    fields: [entries.contentTypeId],
    references: [contentTypes.id],
  }),
  revisions: many(entryRevisions),
}));

// No relation defined toward `user` here — auth.ts (generated) already owns the one
// `relations(user, ...)` call for that table, and drizzle allows only one per table.
export const entryRevisionsRelations = relations(entryRevisions, ({ one }) => ({
  entry: one(entries, { fields: [entryRevisions.entryId], references: [entries.id] }),
}));
