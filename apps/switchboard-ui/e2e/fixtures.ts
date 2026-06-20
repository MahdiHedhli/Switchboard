import { expect, type Page } from '@playwright/test';

/** Single-sourced e2e constants (kept in lockstep with playwright.config.ts). */
export const E2E_OPERATOR_TOKEN = 'e2e-operator-token';
export const PROJECT_ID = 'threatpedia';

/** Every control-plane section heading the dashboard must render. */
export const SECTION_HEADINGS = [
  'Operator session',
  'Quota refresh',
  'Task intake',
  'Model availability',
  'Planning notes',
  'Model selection',
  'Switchboard lanes',
] as const;

/**
 * The dashboard fetches /dashboard, /adapters, /healthz on mount; the static
 * <h1> renders before those settle. Anchor assertions on broker-backed content
 * (the hero's "<profile> · updated …" line) so we act on the loaded DOM.
 */
export async function waitForDashboardLoaded(page: Page): Promise<void> {
  await expect(page.getByText(/profile · updated/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Broker load error/)).toHaveCount(0);
}
