// server/router.mjs

/**
 * Registry mapping base paths to lazy loaders.
 * Each loader returns { base, router } and is mounted on that base.
 */
const REGISTRY = {
  '/api/health': async () => (await import('./routes/health.mjs')).loadRouter('/api/health'),
  '/api/scan': async () => (await import('./routes/scan.mjs')).loadRouter('/api/scan'),
  '/api/queue-scan': async () => (await import('./routes/queue-scan.mjs')).loadRouter('/api/queue-scan'),
  '/api/occupancy': async () => (await import('./routes/occupancy.mjs')).loadRouter('/api/occupancy'),
  '/api/availability-sample': async () => (await import('./routes/availability-sample.mjs')).loadRouter('/api/availability-sample'),
};

/**
 * Mount only the provided base paths. Unknown bases are skipped with a warning.
 * @param {import('express').Express} app
 * @param {string[]} bases
 * @returns {Promise<string[]>}
 */
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