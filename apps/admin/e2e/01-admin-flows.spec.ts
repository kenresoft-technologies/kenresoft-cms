import { test, expect } from '@playwright/test';

// Numbered so this file runs before 02-login.spec.ts under the default single-worker,
// non-parallel config (playwright.config.ts) — it depends on being the very first signup
// against the freshly-reset local D1 (e2e/setup.mjs) to become the deployment's owner
// (docs/ARCHITECTURE.md §10), which content-type and form creation both require.
const API_URL = 'http://localhost:8788';
const ownerEmail = `e2e-owner-${Date.now()}@kenresoft.test`;

test.describe.configure({ mode: 'serial' });

test.describe('admin flows (owner)', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/login');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Name').fill('E2E Owner');
    await page.getByLabel('Email').fill(ownerEmail);
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('/');
    await page.close();
  });

  test('creates a content type, adds a field, and publishes an entry', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(ownerEmail);
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/');

    await page.goto('/content-types');
    await page.getByRole('button', { name: 'New content type' }).click();
    await page.getByLabel('Name').fill('E2E Blog Post');
    await page.getByLabel('Slug').fill('e2e-blog-post');
    await page.getByRole('button', { name: 'Create content type' }).click();
    await expect(page.getByText('Content type created')).toBeVisible();

    // Rows navigate via DataTable's onRowClick, not a real <a> — the name cell is a plain span.
    await page.getByRole('row', { name: /E2E Blog Post/ }).click();
    await page.waitForURL(/\/content-types\/[^/]+$/);

    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByLabel('Name', { exact: true }).fill('title');
    await page.getByLabel('Label').fill('Title');
    await page.getByRole('button', { name: 'Add field' }).click();
    await expect(page.getByText('Field added')).toBeVisible();

    // A throwaway second field, added just to prove edit and delete both work end-to-end
    // (docs/ARCHITECTURE.md — the field-editing gap this whole suite addition traces back to).
    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByLabel('Name', { exact: true }).fill('subtitle');
    await page.getByLabel('Label').fill('Subtitle');
    await page.getByRole('button', { name: 'Add field' }).click();

    const subtitleRow = page.getByRole('row', { name: /subtitle/ });
    await subtitleRow.getByRole('button', { name: 'Edit Subtitle' }).click();
    await page.getByLabel('Label').fill('Byline');
    await page.getByRole('button', { name: 'Save field' }).click();
    await expect(page.getByText('Field updated')).toBeVisible();
    await expect(page.getByRole('row', { name: /byline/i })).toBeVisible();

    await page.getByRole('row', { name: /byline/i }).getByRole('button', { name: /^Delete/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Field deleted')).toBeVisible();
    await expect(page.getByRole('row', { name: /byline/i })).toHaveCount(0);

    // Renaming the content type itself — the other half of the same gap (only fields were
    // uneditable before; the content type's own name/slug had no PATCH route either).
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('E2E Blog Post (renamed)');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Content type updated')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'E2E Blog Post (renamed)' })).toBeVisible();

    await page.getByRole('link', { name: 'View entries' }).click();
    await page.getByRole('link', { name: 'New entry' }).click();

    await page.getByLabel('Slug', { exact: true }).fill('e2e-hello-world');
    await page.getByLabel('Title').fill('Hello from Playwright');
    await page.getByRole('button', { name: 'Save & publish' }).click();

    // save() always navigates back to the entries list (EntryEditorPage.tsx), never staying
    // on the editor — the published status is asserted there, on the new row.
    await page.waitForURL(/\/content-types\/[^/]+\/entries$/);
    const row = page.getByRole('row', { name: /e2e-hello-world/ });
    await expect(row.getByText('published')).toBeVisible();
  });

  test('creates a form, adds a field, and sees a public submission in the inbox', async ({ page, request }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(ownerEmail);
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/');

    await page.goto('/forms');
    await page.getByRole('button', { name: 'New form' }).click();
    await page.getByLabel('Name').fill('E2E Contact');
    await page.getByLabel('Slug').fill('e2e-contact');
    await page.getByRole('button', { name: 'Create form' }).click();

    await page.getByRole('row', { name: /E2E Contact/ }).click();
    await page.waitForURL(/\/forms\/[^/]+$/);
    const formId = page.url().split('/forms/')[1];

    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByLabel('Name', { exact: true }).fill('message');
    await page.getByLabel('Label').fill('Message');
    await page.getByRole('button', { name: 'Add field' }).click();
    await expect(page.getByText('Field added')).toBeVisible();

    // The public submission endpoint is unauthenticated — submitted via a plain HTTP request
    // (Playwright's request fixture, not the page's cookies), the same way a real visitor's
    // browser would call it.
    const response = await request.post(`${API_URL}/api/v1/public/forms/e2e-contact/submissions`, {
      data: { message: 'Hello from Playwright' },
    });
    expect(response.status()).toBe(201);

    await page.goto(`/forms/${formId}/submissions`);
    await expect(page.getByText('No submissions yet')).not.toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(1);
  });

  test('adds a user with a temporary password, then removes them', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(ownerEmail);
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/');

    await page.goto('/users');
    await page.getByRole('button', { name: 'Add user' }).click();
    await page.getByLabel('Name').fill('E2E Invitee');
    await page.getByLabel('Email').fill(`e2e-invitee-${Date.now()}@kenresoft.test`);
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByText('User created')).toBeVisible();

    // The one-time temporary password dialog — a real random value, not a placeholder.
    await expect(page.getByRole('heading', { name: 'E2E Invitee was added' })).toBeVisible();
    const temporaryPassword = await page.getByLabel('Temporary password').inputValue();
    expect(temporaryPassword.length).toBeGreaterThan(16);
    await page.getByRole('button', { name: 'Done' }).click();

    const inviteeRow = page.getByRole('row', { name: /E2E Invitee/ });
    await expect(inviteeRow).toBeVisible();

    await inviteeRow.getByRole('button', { name: /^Remove/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('User removed')).toBeVisible();
    await expect(page.getByRole('row', { name: /E2E Invitee/ })).toHaveCount(0);
  });

  test('creates a global variable, edits its value, sees it on the public API, then deletes it', async ({
    page,
    request,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(ownerEmail);
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/');

    await page.goto('/global-variables');
    await page.getByRole('button', { name: 'New variable' }).click();
    await page.getByLabel('Key').fill('phone_number');
    await page.getByLabel('Value').fill('555-0100');
    await page.getByRole('button', { name: 'Create variable' }).click();
    await expect(page.getByText('Variable created')).toBeVisible();

    const publicRes = await request.get(`${API_URL}/api/v1/public/global-variables`);
    expect(await publicRes.json()).toMatchObject({ phone_number: '555-0100' });

    const row = page.getByRole('row', { name: /phone_number/ });
    await row.getByRole('button', { name: 'Edit phone_number' }).click();
    await page.getByLabel('Value').fill('555-0199');
    await page.getByRole('button', { name: 'Save value' }).click();
    await expect(page.getByText('Variable updated')).toBeVisible();
    await expect(row.getByText('555-0199')).toBeVisible();

    await row.getByRole('button', { name: 'Delete phone_number' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Variable deleted')).toBeVisible();
    await expect(page.getByRole('row', { name: /phone_number/ })).toHaveCount(0);
  });
});
