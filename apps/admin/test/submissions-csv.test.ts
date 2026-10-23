import { describe, expect, it } from 'vitest';

import { submissionsToCsv } from '@/lib/submissions-csv';
import type { FormSubmission } from '@/lib/types';

const base = { formId: 'f', status: 'new', isTest: false, accountUserId: null, stage: null, context: null } as const;
const make = (id: string, createdAt: string, data: Record<string, unknown>, isTest = false) =>
  ({ ...base, id, createdAt, data, isTest }) as unknown as FormSubmission;

describe('submissionsToCsv', () => {
  it('writes a header from every field seen, oldest first, leaving test submissions out', () => {
    const csv = submissionsToCsv([
      make('2', '2026-10-02T00:00:00.000Z', { app: 'b', email: 'b@x.com' }),
      make('1', '2026-10-01T00:00:00.000Z', { app: 'a', email: 'a@x.com', note: 'hi' }),
      make('t', '2026-10-03T00:00:00.000Z', { app: 'test' }, true),
    ]);
    expect(csv.split('\r\n')).toEqual([
      'submitted_at,status,app,email,note',
      '2026-10-01T00:00:00.000Z,new,a,a@x.com,hi',
      '2026-10-02T00:00:00.000Z,new,b,b@x.com,',
    ]);
  });

  it('quotes commas, quotes and newlines, and defuses spreadsheet formulas', () => {
    const csv = submissionsToCsv([
      make('1', '2026-10-01T00:00:00.000Z', { a: 'x, "y"', b: '=HYPERLINK("http://evil")', c: 'line\nbreak' }),
    ]);
    const row = csv.split('\r\n').slice(1).join('\r\n');
    expect(row).toBe(`2026-10-01T00:00:00.000Z,new,"x, ""y""","'=HYPERLINK(""http://evil"")","line\nbreak"`);
  });
});
