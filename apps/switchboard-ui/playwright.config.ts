import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Headless operator-flow + axe e2e (improvement-backlog item 3).
 *
 * Playwright owns both servers via `webServer` so readiness is gated on the
 * broker's /healthz and the UI URL — no hand-rolled wait loop:
 *   1. the broker on a dedicated port (7107, not the dev default 7007), with an
 *      operator token so the create-task flow exercises the real auth gate, and
 *      throwaway STATE/SNAPSHOT dirs so the repo's profiles/threatpedia.json and
 *      working tree are never mutated and the run stays hermetic/offline;
 *   2. the Vite **dev** server (4173) — it is the only server that proxies /api
 *      (vite.config.ts has `server.proxy`, not `preview.proxy`), pointed at the
 *      e2e broker via SWITCHBOARD_BROKER_URL.
 */
const repoRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BROKER_PORT = 7107;
const UI_PORT = 4173;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-e2e-'));
const stateDir = path.join(scratch, 'state');
const snapshotDir = path.join(scratch, 'snapshots');
fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(snapshotDir, { recursive: true });

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'html',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${UI_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node ../broker/dist/index.js',
      url: `http://127.0.0.1:${BROKER_PORT}/healthz`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_BROKER_PORT: String(BROKER_PORT),
        SWITCHBOARD_OPERATOR_TOKEN: 'e2e-operator-token',
        SWITCHBOARD_PROFILES_DIR: path.join(repoRoot, 'profiles'),
        SWITCHBOARD_STATE_DIR: stateDir,
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
      },
    },
    {
      // Bind IPv4 explicitly: Vite's default `localhost` resolves to ::1 on macOS,
      // which the 127.0.0.1 readiness probe (and the IPv4-only broker) can't reach.
      command: `npm run dev -- --port ${UI_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${UI_PORT}`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: { SWITCHBOARD_BROKER_URL: `http://127.0.0.1:${BROKER_PORT}` },
    },
  ],
});
