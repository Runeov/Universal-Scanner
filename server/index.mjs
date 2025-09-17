import express from 'express';
import { registerRoutes } from './router.mjs';

const PORT = Number(process.env.PORT ?? 5174);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Optional bare health endpoint
app.get('/healthz', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Mount only routes that actually exist right now:
const BASES = ['/api/health','/api/scan','/api/occupancy'];
const mounted = await registerRoutes(app, BASES);
console.log('[router] mounted:', mounted.join(', '));

// 404 + error middleware
app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found', path: req.path }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[http] unhandled error:', err);
  res.status(500).json({ ok: false, error: err?.message || String(err) });
});

app.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`);
});
