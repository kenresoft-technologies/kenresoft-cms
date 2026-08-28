import { test, expect } from '@playwright/test';

// Runs after 01-admin-flows.spec.ts (file-order, see that file's comment) — deliberately
// signs up its OWN fresh user rather than reusing the owner from that file, since this test
// only cares about the sign-in/sign-out UX and doesn't need any particular role.
const email = `e2e-user-${Date.now()}@kenresoft.test`;
const name = 'E2E User';
const password = 'correct horse battery staple';

test('signs up, lands on the dashboard showing the user, then signs out back to /login', async ({ page }) => {
  await page.goto('/login');

  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.waitForURL('/');

  // The sidebar shows name-or-email (falls back to email once no name is set) — the Profile
  // page always shows the real email explicitly, which is the more honest assertion target.
  await page.goto('/profile');
  await expect(page.getByLabel('Email')).toHaveValue(email);

  await page.getByRole('button', { name }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  await page.waitForURL('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('rejects a wrong password with a visible error, not a stuck spinner', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('definitely the wrong password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText(/sign in failed|invalid/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});
