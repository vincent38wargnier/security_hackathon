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

export default defineConfig({
  plugins: [react(), {
    name: 'training-route',
    configureServer(server) { server.middlewares.use(trainingRoute); },
    configurePreviewServer(server) { server.middlewares.use(trainingRoute); },
  }],
  build: {
    rollupOptions: { input: fileURLToPath(new URL('./protect.html', import.meta.url)) },
  },
});
