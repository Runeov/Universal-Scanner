// server/routes/occupancy.mjs
import express from 'express';
import * as occupancyEngine from '../occupancy/engine.mjs';

export function loadRouter(base = '/api/occupancy') {
  const router = express.Router();

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
