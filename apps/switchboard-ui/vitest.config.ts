import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dedicated vitest config so the dev/build `vite.config.ts` stays untouched.
// jsdom gives `<App/>` a DOM + localStorage; the test mocks `fetch` so no broker
// is required. Tests live under `test/` (outside `src/**`) so they are excluded
// from the production `tsc` typecheck and the `vite build` entry.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
