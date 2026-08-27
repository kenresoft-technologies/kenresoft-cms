export const FORM_FIELD_TYPES = ['text', 'textarea', 'email', 'url', 'number', 'select', 'checkbox', 'date'] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];
