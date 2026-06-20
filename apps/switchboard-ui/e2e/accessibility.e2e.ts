import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForDashboardLoaded } from './fixtures';

/**
 * axe-core accessibility scan of the loaded dashboard (WCAG 2.0/2.1 A + AA).
 * Scopes to the main view and waits for broker-backed content so axe scans the
 * populated DOM, not the loading skeleton.
 */
test('dashboard main view has no WCAG A/AA accessibility violations', async ({ page }) => {
  await page.goto('/');
  await waitForDashboardLoaded(page);

  const results = await new AxeBuilder({ page })
    .include('main.page')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  // Name the exact offending nodes in the failure message for CI triage.
  const summary = results.violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`)
    .join('\n');

  expect(results.violations, `axe violations:\n${summary}`).toEqual([]);
});
