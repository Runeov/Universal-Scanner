// server/occupancy/engine.mjs
import { pickAdapterByUrl, adapters, providerNameForUrl } from '../providers/index.mjs';
import { REQUEST_KEY_HINTS } from './hints.mjs';
import { normalizeRating10, bucketRoomType, buildDatesISO } from './normalize.mjs';
import {
  extractEndpointsFromScan, // generic discovery helpers
  scoreCandidateGeneric,
  suggestParamMapFromUrl,
  buildUrlWithParams,
  safeJson,
} from './utils.mjs';

const DEFAULT_CATEGORY = 'accommodation';

function rankAndLimit(cands, limit = 10) {
  const dedup = new Map();
  for (const c of cands) {
    const key = `${c.url}|${c.method || 'GET'}`;
    const prev = dedup.get(key);
    if (!prev || (c.score || 0) > (prev.score || 0)) dedup.set(key, c);
  }
  return Array.from(dedup.values())
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit);
}

export async function discover(scan, opts = {}) {
  const category = opts.category || DEFAULT_CATEGORY;

  // 1) Generic extraction from your scan JSON
  const generic = extractEndpointsFromScan(scan).map((e) => {
    const base = {
      url: e.url,
      method: e.method || 'GET',
      contentType: e.contentType || '',
      provider: providerNameForUrl(e.url),
    };
    const baseScore = scoreCandidateGeneric(e, { hints: REQUEST_KEY_HINTS, category });
    return {
      ...base,
      score: baseScore,
      paramMapSuggestion: suggestParamMapFromUrl(e.url, REQUEST_KEY_HINTS),
      source: 'generic',
    };
  });

  // 2) Provider-specific discovery boosters
  const boosted = [];
  for (const a of adapters) {
    try {
      const found = a.discoverFromScan ? a.discoverFromScan(scan, { REQUEST_KEY_HINTS }) : [];
      for (const f of found) {
        const sug = a.suggestParamMapFromUrl ? a.suggestParamMapFromUrl(f.url, REQUEST_KEY_HINTS) : null;
        boosted.push({
          ...f,
          provider: a.name,
          score: (f.score || 0) + 2, // small boost for provider-aware hits
          paramMapSuggestion: sug,
          source: a.name,
        });
      }
    } catch {}
  }

  // 3) Merge & rank
  const ranked = rankAndLimit([...generic, ...boosted], 12);
  return { ok: true, category, candidates: ranked };
}

export async function extract(payload, opts = {}) {
  // payload: { BASE_URL, method, paramMap, venueId, adults, children, extra, dates[], nights, throttleMs, filters }
  const {
    BASE_URL,
    method = 'GET',
    paramMap = {},
    venueId,
    adults = 2,
    children = 0,
    extra = {},
    dates = [],
    nights = 1,
    throttleMs = 0,
    filters = {},
  } = payload || {};

  if (!BASE_URL || !Array.isArray(dates) || !dates.length) {
    return { ok: false, error: 'BASE_URL and dates[] required' };
  }

  const adapter = pickAdapterByUrl(BASE_URL);
  const out = { ok: true, provider: adapter?.name || 'generic', startedAt: new Date().toISOString() };
  const results = [];
  const errors = [];
  const runDates = dates.map((d) => (typeof d === 'string' ? d : d.checkIn)).filter(Boolean);

  for (let i = 0; i < runDates.length; i++) {
    const ci = runDates[i];
    const co = buildDatesISO.addNights(ci, nights); // co is ISO YYYY-MM-DD
    const url = buildUrlWithParams(BASE_URL, {
      checkInKey: paramMap.checkIn,
      checkOutKey: paramMap.checkOut,
      adultsKey: paramMap.adults,
      childrenKey: paramMap.children,
      venueIdKey: paramMap.venueId,
      extra,
      checkIn: ci,
      checkOut: co,
      adults,
      children,
      venueId,
      method,
    });

    try {
      const res = await fetch(url, { method, headers: { 'accept': 'application/json' } });
      const text = await res.text();
      const json = safeJson(text);
      const interpret = adapter?.interpret ?? ((j) => (j && typeof j === 'object' ? {} : null));
      const info = interpret(json) || {};

      // normalize & compute small aggregates
      const occupied = !!info.occupied;
      const price = info.price != null ? Number(info.price) : null;
      const rating10 = info.rating != null ? normalizeRating10(info.rating) : null;
      const roomBucket = info.roomType ? bucketRoomType(info.roomType) : null;

      results.push({
        id: ci,
        checkIn: ci,
        checkOut: co,
        occupied,
        price,
        rating10,
        roomType: roomBucket,
        url,
        raw: info.rawPreview || null,
      });

      if (throttleMs) await new Promise((r) => setTimeout(r, throttleMs));
    } catch (e) {
      errors.push({ id: ci, error: String(e?.message || e) });
      results.push({ id: ci, checkIn: ci, checkOut: co, error: String(e?.message || e), url });
    }
  }

  // Mini summary (period occupancy, 10% low price avg)
  const oks = results.filter((r) => r.error == null);
  const occVals = oks.map((r) => (r.occupied ? 1 : 0));
  const periodOccupancyPct = occVals.length ? occVals.reduce((a, b) => a + b, 0) / occVals.length : null;

  const priceVals = oks.map((r) => (typeof r.price === 'number' ? r.price : null)).filter((v) => v != null);
  let avgPrice = null, avgPriceLow10 = null;
  if (priceVals.length) {
    const sorted = [...priceVals].sort((a, b) => a - b);
    avgPrice = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const k = Math.max(1, Math.floor(sorted.length * 0.10));
    const low10 = sorted.slice(0, k);
    avgPriceLow10 = low10.reduce((a, b) => a + b, 0) / low10.length;
  }

  out.results = results;
  out.summary = {
    periodOccupancyPct,
    avgPrice,
    avgPriceLow10,
    errors: errors.length,
    nights,
  };
  out.endedAt = new Date().toISOString();
  out.ms = new Date(out.endedAt) - new Date(out.startedAt);
  return out;
}

export default { discover, extract };
