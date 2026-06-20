import { test, expect } from '@playwright/test';
import { E2E_OPERATOR_TOKEN, SECTION_HEADINGS, waitForDashboardLoaded } from './fixtures';

/**
 * Walks the core operator flow against a live broker: load the dashboard, see the
 * plan / providers / selection surface, then create a task and watch it appear.
 */
test('operator loads the dashboard and creates a task end to end', async ({ page }) => {
  await page.goto('/');
  await waitForDashboardLoaded(page);

  // Every control-plane section is present.
  for (const name of SECTION_HEADINGS) {
    await expect(page.getByRole('heading', { name })).toBeVisible();
  }

  // The model-selection surface rendered with the seeded catalog placeholders.
  await expect(page.getByRole('heading', { name: 'Model catalog' })).toBeVisible();
  await expect(page.getByText('xai/grok-cli')).toBeVisible();

  // Task creation is gated on an operator token: disabled until one is entered.
  const createButton = page.getByRole('button', { name: 'Create task' });
  await expect(createButton).toBeDisabled();
  await page.getByLabel('Operator token').fill(E2E_OPERATOR_TOKEN);
  await expect(createButton).toBeEnabled();

  // Fill + submit, anchoring on the real broker round-trip (not a timeout).
  const title = `E2E routing check ${Date.now()}`;
  await page.locator('input[name="title"]').fill(title);
  await page.locator('textarea[name="description"]').fill('Created by the Playwright operator-flow e2e.');

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => /\/v1\/projects\/threatpedia\/tasks$/.test(r.url()) && r.request().method() === 'POST',
    ),
    createButton.click(),
  ]);
  expect(response.status()).toBe(201);

  // The broker's returned snapshot re-renders the lanes with the new task.
  await expect(page.getByText(title)).toBeVisible();
  // The create form reset after success.
  await expect(page.locator('input[name="title"]')).toHaveValue('');
});
