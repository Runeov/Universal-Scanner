// server/index.mjs
import express from 'express';
import cors from 'cors';
import { registerRoutes } from './router.mjs';
import path from 'node:path';

// Ensure LOG_DIR is always set (one place, one time)
if (!process.env.LOG_DIR || !process.env.LOG_DIR.trim()) {
  process.env.LOG_DIR = path.join(process.cwd(), 'logs');
}
console.log('[logs] LOG_DIR =', process.env.LOG_DIR);
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason);
});


// Boot-time diagnostics
console.log('[server] cwd =', process.cwd());
console.log('[server] LOG_DIR =', process.env.LOG_DIR || '(not set)');




const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Which base paths to mount (comma-separated). Default mounts all known routes.
const ROUTES_TO_MOUNT = (process.env.ROUTES || [
  '/api/health',
  '/api/scan',
  '/api/queue-scan',
  '/api/occupancy',
  '/api/availability-sample',
].join(','))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Mount routers
const mounted = await registerRoutes(app, ROUTES_TO_MOUNT);
console.log('[router] mounted:', mounted);

// 404 + error handlers
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found', path: req.originalUrl });
});
app.use((err, _req, res, _next) => {
  console.error('[unhandled-error]', err);
  res.status(500).json({ ok: false, error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 5174;
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});





  






