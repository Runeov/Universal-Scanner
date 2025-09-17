import express from 'express';
import { discoverFromScan, extractOccupancy } from '../occupancy.mjs';
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
<<<<<<< Updated upstream
      const out = await extractOccupancy({ BASE_URL, method, paramMap, venueId, adults, dates, interpret, throttleMs });
=======
const out = await occupancyEngine.extract({ BASE_URL, method, paramMap, venueId, adults, children, dates, nights, extra, throttleMs, filters });
>>>>>>> Stashed changes
      res.json({ ok: true, ...out });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

// after setCandidates(data.candidates):
if (!BASE_URL && data.candidates?.length) {
  const top = data.candidates[0];
  setBASE_URL(top.url);
  if (top.paramMapSuggestion) {
    setCheckInKey(top.paramMapSuggestion.checkIn || 'checkin');
    setCheckOutKey(top.paramMapSuggestion.checkOut || 'checkout');
    setAdultsKey(top.paramMapSuggestion.adults || 'adults');
    setVenueIdKey(top.paramMapSuggestion.venueId || '');
    // children optional:
    if (top.paramMapSuggestion.children) setChildrenKey?.(top.paramMapSuggestion.children);
  }
}


  return { base, router };
}
