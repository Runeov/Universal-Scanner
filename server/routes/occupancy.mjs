// server/routes/occupancy.mjs
// server/routes/occupancy.mjs
import express from 'express';
// IMPORTANT in this branch: use the engine under /occupancy
import * as occupancyEngine from '../occupancy/engine.mjs';

export function loadRouter(base = '/api/occupancy') {
  const router = express.Router();

  router.post('/discover', async (req, res) => {
  try {
    const scan = req.body ?? {};

    // Normalize from your uploaded shape
    const endpoints = Array.isArray(scan?.endpoints)
      ? scan.endpoints.map(e => (typeof e === 'string' ? { url: e } : { url: e?.url })).filter(x => x?.url)
      : [];

    const apiCandidates = Array.isArray(scan?.browser?.apiCandidates)
      ? scan.browser.apiCandidates.map(c => ({ url: c?.url, method: c?.method, contentType: c?.contentType })).filter(x => x?.url)
      : [];

    const deepLinks = Array.isArray(scan?.browser?.deepLinks)
      ? scan.browser.deepLinks.map(d => ({ url: d?.href || d?.url })).filter(x => x?.url)
      : [];

    const normalized = {
      summary: { category: scan?.summary?.category || 'accommodation' },
      endpoints,
      browser: { apiCandidates, deepLinks },
    };

    const out = await occupancyEngine.discover(normalized, { category: normalized.summary.category });
    return res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[discover] ERROR:', err?.message, err?.stack);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});


  router.post('/extract', async (req, res) => {
    req.setTimeout?.(10 * 60 * 1000);
    try {
      const {
        BASE_URL,
        baseUrl,
        method,
        paramMap = {},
        venueId,
        adults,
        children,
        dates,
        nights,
        extra,
        throttleMs,
        filters,
      } = req.body || {};

      const BASE = BASE_URL || baseUrl;
      if (!BASE || !paramMap?.checkIn || !paramMap?.checkOut || !Array.isArray(dates)) {
        return res.status(400).json({
          ok: false,
          error: 'Required: BASE_URL (or baseUrl), paramMap.checkIn, paramMap.checkOut, dates[]',
        });
      }

      const out = await occupancyEngine.extract({
        BASE_URL: BASE,
        baseUrl: BASE,
        method,
        paramMap,
        venueId,
        adults,
        children,
        dates,
        nights,
        extra,
        throttleMs,
        filters,
      });

      return res.json(out);
    } catch (err) {
      console.error('[occupancy] /extract error:', err);
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return { base, router };
}
