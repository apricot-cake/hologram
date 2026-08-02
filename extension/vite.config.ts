import { crx } from '@crxjs/vite-plugin';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import manifest, { EXTENSION_ID } from './manifest.config.ts';

export default defineConfig(({ command, mode }) => {
  const browser = mode === 'firefox' ? 'firefox' : 'chrome';
  const development = command === 'serve';
  const developmentOutput = process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT ? resolve(process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT) : resolve(import.meta.dirname, '.output/chrome-mv3');
  // The daily server owns 51731 and never wanders off it. The override exists so
  // the HMR reconnect regression test can run a second server of its own next to
  // it; CRXJS bakes this port into the bootstrap it writes, so a test build
  // points its disposable browser at the test server and nothing else.
  const developmentPort = Number(process.env.HOLOGRAM_EXTENSION_DEV_PORT) || 51731;

  return {
    plugins: [
      {
        name: 'hologram-dev-probe',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use('/manifest.json', async (_request, response) => {
            try {
              response.setHeader('Content-Type', 'application/json; charset=utf-8');
              response.end(await readFile(resolve(developmentOutput, 'manifest.json')));
            } catch {
              response.statusCode = 503;
              response.end('{"error":"manifest-not-ready"}');
            }
          });
          // The service worker is the only client holding an HMR socket of its
          // own (content scripts reach it through a chrome.runtime port), so
          // this count answers whether the extension is still attached to this
          // server. Serving the manifest proves nothing about that.
          server.middlewares.use('/@hologram/dev-status', (_request, response) => {
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(JSON.stringify({ hmrClients: server.ws.clients.size }));
          });
        },
      },
      crx({
        manifest,
        browser,
        contentScripts: {
          // `capture.ts` is not declared in the manifest: background injection
          // needs its emitted IIFE path via `?script`. Keep resident standalone
          // too so the release manifest never points at an ESM loader graph.
          standaloneFiles: ['entrypoints/capture.ts', 'entrypoints/resident.content.ts'],
        },
      }),
    ],
    publicDir: 'public',
    server: {
      host: '127.0.0.1',
      port: developmentPort,
      strictPort: true,
      open: false,
      cors: {
        origin: `chrome-extension://${EXTENSION_ID}`,
      },
      hmr: {
        host: '127.0.0.1',
        port: developmentPort,
      },
    },
    build: {
      outDir: development ? developmentOutput : `.output/${browser}-mv3-release`,
      emptyOutDir: true,
      modulePreload: false,
      sourcemap: false,
      rollupOptions: {
        input: {
          diag: resolve(import.meta.dirname, 'diag.html'),
        },
      },
    },
  };
});
