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
});
