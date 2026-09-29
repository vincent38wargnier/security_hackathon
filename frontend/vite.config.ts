import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

function trainingRoute(req: IncomingMessage, _res: ServerResponse, next: () => void) {
  if (req.url && /^\/(?:protect\/?)?(?:\?|$)/.test(req.url)) {
    const query = req.url.indexOf('?');
    req.url = '/protect.html' + (query >= 0 ? req.url.slice(query) : '');
  }
  next();
}

// Development-only proxy to Vincent's lab server (server.py). Explicit loopback target; the browser
// only ever calls same-origin /lab-api/*. No key or upstream URL is configurable from the client.
const labPort = Number(process.env.VULN_LAB_PORT || 8850);
if (!Number.isInteger(labPort) || labPort < 1024 || labPort > 65535) throw new Error('VULN_LAB_PORT must be a local port number.');
const labProxy = { '/lab-api': { target: `http://127.0.0.1:${labPort}`, changeOrigin: false, rewrite: (path: string) => path.replace(/^\/lab-api(?=\/(?:health|chat)$)/, '/api') } };

export default defineConfig({
  server: { proxy: labProxy },
  preview: { proxy: labProxy },
  plugins: [react(), {
    name: 'training-route',
    configureServer(server) { server.middlewares.use(trainingRoute); },
    configurePreviewServer(server) { server.middlewares.use(trainingRoute); },
  }],
  build: {
    rollupOptions: { input: fileURLToPath(new URL('./protect.html', import.meta.url)) },
  },
});
