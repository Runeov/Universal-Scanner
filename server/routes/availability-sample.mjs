// server/routes/availability-sample.mjs
import express from 'express';
import { browseAndCapture } from '../browser.mjs';

export function loadRouter(base = '/api/availability-sample') {
  const router = express.Router();

  // NOTE: path is '/' because this router is mounted at /api/availability-sample
  router.post('/', async (req, res) => {
    try {
      const { place = "Tromsø", dates = [], nights = 1, maxRetries = 1 } = req.body || {};
      if (!Array.isArray(dates) || dates.length === 0) {
        return res.status(400).json({ error: "dates[] required" });
      }

      // ── total timer for this capture batch
      const __rid = Math.random().toString(36).slice(2, 7);
      const __label = `[avail ${String(place).trim()} ${__rid}]`;
      const __t0 = Date.now();
      console.time(__label);
      console.log(__label, 'start', { nights, dates: dates.length });

      const trimmedPlace = String(place || '').trim();
      const poolSize = 2; // small pool reduces blocks
      const jitter = () => new Promise(r => setTimeout(r, 200 + Math.random() * 300));

      let universeSizeHint = 0;
      const failed = [];

      function buildSrpUrl(dstr) {
        const ci = new Date(dstr);
        const co = new Date(ci); co.setDate(ci.getDate() + Number(nights || 1));
        const checkin  = ci.toISOString().slice(0,10);
        const checkout = co.toISOString().slice(0,10);
        // fixed language to stabilize DOM text patterns
        return `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(trimmedPlace)}&checkin=${checkin}&checkout=${checkout}&group_adults=2&no_rooms=1&lang=en-us`;
      }

      async function sampleDate(dstr) {
        const srp = buildSrpUrl(dstr);
        const checkin = new Date(dstr).toISOString().slice(0,10);
        let total = null;
        let uniCount = 0;

        // Attempt 0 — fast path (DOM-only, quick timeouts)
        try {
          const cap = await browseAndCapture({
            url: srp,
            headless: true,
            timeoutMs: 12000,   // overall guard; fastMode uses much shorter per-attempts
            sameOrigin: false,
            autoScroll: false,
            preferHttp1: true,  // start HTTP/1.1
            navQuick: true,     // commit-only short nav timeouts
            fastMode: true      // DOM-only, no CDP/listeners
          });
          const totals = cap.browserSearch?.searchTotals || [];
          total = totals.length ? totals[totals.length - 1].total : null;
          uniCount = cap.browserSearch?.universeIdsCount || 0;
        } catch {}

        // Attempt 1 — standard path (one retry) if nothing found and retry allowed
        if (total == null && maxRetries > 0) {
          try {
            const cap = await browseAndCapture({
              url: srp,
              headless: true,
              timeoutMs: 20000,
              sameOrigin: false,
              autoScroll: true,
              preferHttp1: true,   // skip HTTP/2
              navQuick: false,     // allow longer settle
              fastMode: false      // enable JSON listeners as backup
            });
            const totals = cap.browserSearch?.searchTotals || [];
            total = totals.length ? totals[totals.length - 1].total : null;
            uniCount = Math.max(uniCount, cap.browserSearch?.universeIdsCount || 0);
          } catch {}
        }

        if (total == null) {
          failed.push(checkin);
          return { date: checkin, available: null };
        }
        if (uniCount > universeSizeHint) universeSizeHint = uniCount;
        return { date: checkin, available: total };
      }

      async function runPool(arr, limit) {
        const out = new Array(arr.length);
        let idx = 0;
        const workers = Array.from({ length: Math.min(limit, arr.length) }, async () => {
          while (true) {
            const i = idx++;
            if (i >= arr.length) break;
            out[i] = await sampleDate(arr[i]);
            await jitter();
          }
        });
        await Promise.all(workers);
        return out;
      }

      const samplesRaw = await runPool(dates, poolSize);

      // Denominator heuristic
      const universeSize = Math.max(
        universeSizeHint,
        ...samplesRaw.map(s => s.available || 0)
      ) || 0;

      const samples = samplesRaw.map(s => ({
        ...s,
        occupancyPct: (s.available != null && universeSize > 0)
          ? Math.max(0, Math.min(1, 1 - s.available / universeSize))
          : null
      }));

      const vals = samples.map(s => s.occupancyPct).filter(v => v != null);
      const avgOccupancyPct = vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : null;

      const durationMs = Date.now() - __t0;
      console.timeEnd(__label);
      console.log(__label, 'done', { durationMs, universeSize, failed: failed.length });

      return res.json({ place: trimmedPlace, nights, universeSize, samples, avgOccupancyPct, failed, durationMs });
    } catch (err) {
      console.error('[availability-sample] fatal', err);
      res.status(500).json({ error: String((err && err.stack) || err) });
    }
  });

  return { base, router };
}
