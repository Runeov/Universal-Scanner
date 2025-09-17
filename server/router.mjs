// server/router.mjs  (YOUR VERSION — KEEP)
const REGISTRY = {
  '/api/health': async () => (await import('./routes/health.mjs')).loadRouter('/api/health'),
  '/api/scan': async () => (await import('./routes/scan.mjs')).loadRouter('/api/scan'),
  '/api/queue-scan': async () => (await import('./routes/queue-scan.mjs')).loadRouter('/api/queue-scan'),
  '/api/occupancy': async () => (await import('./routes/occupancy.mjs')).loadRouter('/api/occupancy'),
  '/api/availability-sample': async () => (await import('./routes/availability-sample.mjs')).loadRouter('/api/availability-sample'),
};

export async function registerRoutes(app, bases = []) {
  const mounted = [];
  for (const base of bases) {
    const loader = REGISTRY[base];
    if (!loader) {
      console.warn(`[router] no loader for base "${base}", skipping`);
      continue;
    }
    const { base: mountBase, router } = await loader();
    app.use(mountBase, router);
    mounted.push(mountBase);
  }
  return mounted;
}
