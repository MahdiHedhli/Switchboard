import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const brokerTarget = process.env.SWITCHBOARD_BROKER_URL ?? 'http://127.0.0.1:7007';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: brokerTarget,
        changeOrigin: true,
        rewrite: (pathname) => pathname.replace(/^\/api/, ''),
      },
    },
  },
});
