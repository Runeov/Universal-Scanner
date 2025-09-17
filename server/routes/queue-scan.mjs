import express from 'express';
import { scanSite } from '../scan.mjs';
import { browseAndCapture } from '../browser.mjs';
import { mergeResults, sumByHost } from '../utils/merge.mjs';
import { normalizeForUI } from '../utils/normalize-ui.mjs';


export function loadRouter(base = '/api/queue-scan') {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const {
        base: baseResult,
        links = [],
        sameOrigin = true,
        maxDepth = 0,
        maxPages = 6,
        timeoutMs = 15000,
        mode = 'both',
        navAllowPatterns = [],
        storage,
      } = req.body || {};

      if (!Array.isArray(links) || links.length === 0) {
        return res.status(400).json({ error: 'links[] required' });
      }

      let merged = baseResult || {};
      const navTrail = [];

      for (const raw of links.slice(0, 25)) {
        const href = typeof raw === 'string' ? raw : raw.href;
        const from =
          typeof raw === 'string'
            ? (baseResult?.summary?.seedUrl || '')
            : (raw.from || baseResult?.summary?.seedUrl || '');

        if (!href) continue;

        const httpPart = await scanSite({
          seedUrl: href,
          maxDepth: Number(maxDepth),
          sameOrigin: Boolean(sameOrigin),
          maxPages: Number(maxPages),
          timeoutMs: Number(timeoutMs),
        });

        let browserPart = null;
        if (mode === 'both' || mode === 'browser') {
          browserPart = await browseAndCapture({
            url: href,
            headless: true,
            timeoutMs: Math.max(Number(timeoutMs), 25000),
            sameOrigin: Boolean(sameOrigin),
            autoScroll: true,
            navAllowPatterns,
            storage,
          });
        }

        const perLink =
          mode === 'http'
            ? httpPart
            : mode === 'browser'
              ? {
                  browser: browserPart,
                  summary: {
                    seedUrl: href,
                    browserApiCandidates: browserPart?.summary?.apiCandidates || 0,
                    browserTotalRequests: browserPart?.summary?.totalRequests || 0,
                  },
                  byHost: browserPart?.byHost || {},
                }
              : {
                  ...httpPart,
                  browser: browserPart,
                  summary: {
                    ...(httpPart.summary || {}),
                    browserApiCandidates: browserPart?.summary?.apiCandidates || 0,
                    browserTotalRequests: browserPart?.summary?.totalRequests || 0,
                  },
                  byHost: sumByHost(httpPart.byHost, browserPart?.byHost || {}),
                };

        navTrail.push({
          from,
          to: href,
          pageTitle: browserPart?.pageTitle || '',
          kind: mode,
          when: new Date().toISOString(),
        });
        perLink.navTrail = navTrail.slice(-1);

        merged = mergeResults(merged, perLink);
      }

      return res.json(normalizeForUI(merged));
    } catch (err) {
      console.error('[queue-scan] fatal', err);
      res.status(500).json({ error: String(err?.stack || err) });
    }
  });

  return { base, router };
}
