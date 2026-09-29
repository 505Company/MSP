import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('.', import.meta.url))
const app = fileURLToPath(new URL('..', import.meta.url))
export default defineConfig({
  root, publicDir: `${app}/public`, cacheDir: `${app}/node_modules/.vite-component-lab`,
  resolve: { alias: { '@': app } },
  server: { host: '127.0.0.1', port: 5197, strictPort: true, fs: { allow: [app] },
    proxy: { '/api': { target: 'http://127.0.0.1:5184', changeOrigin: true, configure(proxy) {
      proxy.on('proxyReq', (outgoing, request) => {
        // The local middleware checks the browser origin before forwarding.
        if (request.method === 'POST' && /^\/api\/uploads\/[^/]+\/component-profiles\?/.test(request.url ?? '')) outgoing.setHeader('origin', 'http://127.0.0.1:5184')
      })
    } } },
  },
  // Only component-rule revisions may be written. Source APIs remain read-only.
  plugins: [{ name: 'component-lab-isolated', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (/^\/api\/uploads\/[^/]+\/component-profiles\?/.test(req.url ?? '') && ['GET', 'HEAD', 'POST'].includes(req.method ?? '')) {
        if (req.method === 'POST' && (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` || req.headers['sec-fetch-site'] === 'cross-site')) { res.statusCode = 403; res.end('Origin rejected'); return }
        next(); return
      }
      if (req.url?.startsWith('/api/') && (!['GET', 'HEAD'].includes(req.method ?? '') || !/^\/api\/(?:style-bank(?:\?|$)|uploads\/[^/]+\/(?:editable-system(?:\?|$)|fonts(?:\?|$)|assets\/)|fonts\/google(?:\?|$))/.test(req.url))) { res.statusCode = 405; res.end('Component lab only reads source catalogs and fonts'); return }
      next()
    })
  } }],
  build: { outDir: `${app}/outputs/component-lab-dist`, emptyOutDir: true },
})
