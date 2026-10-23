import type { FormSubmission } from '@/lib/types';

// A cell that starts with one of these is run as a formula by Excel and Sheets, so visitor-typed
// text could execute on whoever opens the export. A leading apostrophe makes it plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// One row per submission, one column per field name seen across them (in first-seen order), plus
// when it came in and its inbox status. Test submissions are left out: the export is real data.
export function submissionsToCsv(submissions: FormSubmission[]): string {
  const real = submissions.filter((submission) => !submission.isTest);
  const fieldNames: string[] = [];
  for (const submission of real) {
    for (const name of Object.keys(submission.data)) {
      if (!fieldNames.includes(name)) fieldNames.push(name);
    }
  }
  const header = ['submitted_at', 'status', ...fieldNames].map(cell).join(',');
  const rows = [...real]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((submission) =>
      [submission.createdAt, submission.status, ...fieldNames.map((name) => submission.data[name])].map(cell).join(','),
    );
  return [header, ...rows].join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
