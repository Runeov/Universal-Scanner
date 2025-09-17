// server/routes/occupancy.mjs
import express from 'express';
import * as occupancyEngine from '../occupancy/engine.mjs';

export function loadRouter(base = '/api/occupancy') {
  const router = express.Router();

  // Discover occupancy candidates from a prior scan result
  router.post('/discover', async (req, res) => {
    try {
      const scanResult = req.body;
      if (!scanResult || typeof scanResult !== 'object') {
        return res.status(400).json({ ok: false, error: 'Body must be a prior scan result JSON' });
      }
      const category = scanResult?.summary?.category || 'accommodation';
      const out = await occupancyEngine.discover(scanResult, { category });
      return res.json(out);
    } catch (err) {
      console.error('[occupancy] /discover error:', err);
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // Extract occupancy across a set of dates for one endpoint + param map
  router.post('/extract', async (req, res) => {
    // allow long-running extraction
    req.setTimeout?.(10 * 60 * 1000);

    try {
      const {
        // accept both legacy and new names
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

      // validate minimal required fields
      if (!BASE || !paramMap?.checkIn || !paramMap?.checkOut || !Array.isArray(dates)) {
        return res.status(400).json({
          ok: false,
          error: 'Required: BASE_URL (or baseUrl), paramMap.checkIn, paramMap.checkOut, dates[]',
        });
      }

      // Call the engine; it accepts either key, we pass both for compatibility.
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

      // engine returns { ok, ... }; just forward it
      return res.json(out);
    } catch (err) {
      console.error('[occupancy] /extract error:', err);
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return { base, router };
}
