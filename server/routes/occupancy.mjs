import express from 'express';
import { discoverFromScan, extractOccupancy } from '../occupancy.mjs';

export function loadRouter(base = '/api/occupancy') {
  const router = express.Router();

  router.post('/discover', async (req, res) => {
    try {
      const scanResult = req.body;
      if (!scanResult || typeof scanResult !== 'object') {
        return res.status(400).json({ ok: false, error: 'Body must be a prior scan result JSON' });
      }
      const candidates = discoverFromScan(scanResult);
      res.json({ ok: true, candidates });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  router.post('/extract', async (req, res) => {
    req.setTimeout?.(10 * 60 * 1000);
    try {
      const { BASE_URL, method, paramMap, venueId, adults, dates, interpret, throttleMs } = req.body || {};
      if (!BASE_URL || !paramMap?.checkIn || !paramMap?.checkOut || !Array.isArray(dates)) {
        return res.status(400).json({ ok: false, error: 'Required: BASE_URL, paramMap.checkIn, paramMap.checkOut, dates[]' });
      }
      const out = await extractOccupancy({ BASE_URL, method, paramMap, venueId, adults, dates, interpret, throttleMs });
      res.json({ ok: true, ...out });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return { base, router };
}
