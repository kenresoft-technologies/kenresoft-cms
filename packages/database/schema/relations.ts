import { relations } from 'drizzle-orm';

import { contentTypes } from './content-types';
import { fieldDefinitions } from './field-definitions';
import { entries } from './entries';
import { entryRevisions } from './entry-revisions';
import { forms } from './forms';
import { formFields } from './form-fields';
import { formSubmissions } from './form-submissions';
import { webhooks, webhookDeliveries } from './webhooks';

export const contentTypesRelations = relations(contentTypes, ({ many }) => ({
  fields: many(fieldDefinitions),
  entries: many(entries),
  webhooks: many(webhooks),
}));

export const fieldDefinitionsRelations = relations(fieldDefinitions, ({ one }) => ({
  contentType: one(contentTypes, {
    fields: [fieldDefinitions.contentTypeId],
    references: [contentTypes.id],
  }),
}));

export const entriesRelations = relations(entries, ({ one, many }) => ({
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

export const formsRelations = relations(forms, ({ many }) => ({
  fields: many(formFields),
  submissions: many(formSubmissions),
}));

export const formFieldsRelations = relations(formFields, ({ one }) => ({
  form: one(forms, { fields: [formFields.formId], references: [forms.id] }),
}));

export const formSubmissionsRelations = relations(formSubmissions, ({ one }) => ({
  form: one(forms, { fields: [formSubmissions.formId], references: [forms.id] }),
}));

export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  contentType: one(contentTypes, { fields: [webhooks.contentTypeId], references: [contentTypes.id] }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, { fields: [webhookDeliveries.webhookId], references: [webhooks.id] }),
}));
