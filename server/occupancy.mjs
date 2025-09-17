// server/occupancy.mjs
import { setTimeout as delay } from "node:timers/promises";

/** tiny dot-path getter: "data.room.available" */
function getByPath(obj, path) {
  if (!path) return obj;
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/**
 * Heuristic discovery: pull likely availability endpoints from a prior scan result.
 * scanResult: the JSON your /api/scan returns (merged http+browser if you used "both")
 */
export function discoverFromScan(scanResult) {
  const candidates = [];

  const pushIfLikely = (source, url, sample) => {
    const text = JSON.stringify(sample || {}, null, 0).toLowerCase();
    const hits = [
      "availability", "available", "soldout", "sold_out", "roomsleft", "rooms_left",
      "in_stock", "inventory", "bookable", "checkin", "checkout", "date", "calendar"
    ].filter(k => text.includes(k));
    if (hits.length) candidates.push({ source, url, hints: hits.slice(0, 6) });
  };

  // HTTP arrays and endpoints (static fetch pass)
  for (const a of scanResult.arrays ?? []) {
    pushIfLikely("http-array", a.sourceUrl, { sample: a.sample, columns: a.columns, path: a.path });
  }
  for (const e of scanResult.endpoints ?? []) {
    pushIfLikely("http-endpoint", e.url, e.preview ?? {});
  }

  // Browser runtime arrays / candidates (Playwright pass)
  for (const s of scanResult.browser?.arraySummaries ?? []) {
    pushIfLikely("browser-array", s.atUrl, { path: s.path, columns: s.columns });
  }
  for (const c of scanResult.browser?.apiCandidates ?? []) {
    pushIfLikely("browser-candidate", c.url, { method: c.method, contentType: c.contentType });
  }

  // De-dupe by URL
  const seen = new Set();
  const dedup = [];
  for (const c of candidates) {
    if (!seen.has(c.url)) {
      seen.add(c.url);
      dedup.push(c);
    }
  }
  return dedup;
}

/**
 * Fast server-side extractor: call a known API endpoint for date intervals and
 * decide occupancy=TRUE when the response matches your predicate.
 *
 * @param {{
 *   BASE_URL: string,                  // e.g. "https://api.example.com/availability"
 *   method?: "GET"|"POST",            // default GET
 *   paramMap: {                       // how to pass dates/search params
 *     checkIn: string,                // e.g. "checkin"
 *     checkOut: string,               // e.g. "checkout"
 *     adults?: string,                // e.g. "adults"
 *     venueId?: string,               // optional
 *     extra?: Record<string,string>   // static key->value to always include
 *   },
 *   venueId?: string|number,
 *   adults?: number,
 *   dates: Array<{checkIn: string, checkOut: string, id?: string}>,
 *   interpret: {                      // how to turn JSON -> occupied boolean
 *     path: string,                   // dot path to value (e.g. "data.roomsLeft")
 *     op: "truthy"|"gt"|"eq"|"lt",    // simple ops
 *     value?: number|string|boolean   // for gt/eq/lt
 *   },
 *   throttleMs?: number               // small delay between calls
 * }} cfg
 *
 * Returns: { results: [{id, checkIn, checkOut, occupied, raw}], stats: {...} }
 */
export async function extractOccupancy(cfg) {
  const {
    BASE_URL,
    method = "GET",
    paramMap,
    venueId,
    adults = 2,
    dates,
    interpret,
    throttleMs = 120
  } = cfg;

  if (!BASE_URL || !paramMap?.checkIn || !paramMap?.checkOut || !Array.isArray(dates)) {
    throw new Error("extractOccupancy config missing BASE_URL/paramMap/dates");
  }

  const buildUrl = (ci, co) => {
    const url = new URL(BASE_URL);
    const qp = url.searchParams;
    qp.set(paramMap.checkIn, ci);
    qp.set(paramMap.checkOut, co);
    if (paramMap.adults) qp.set(paramMap.adults, String(adults));
    if (paramMap.venueId && venueId != null) qp.set(paramMap.venueId, String(venueId));
    for (const [k, v] of Object.entries(paramMap.extra ?? {})) qp.set(k, v);
    return url.toString();
  };

  const runFetch = async (u) => {
    const res = await fetch(u, { method, headers: { "accept": "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      // Some APIs return JS or text+json; try anyway
      try { return await res.json(); } catch (_) {
        const text = await res.text();
        throw new Error(`Non-JSON response (${ct}): ${text.slice(0, 120)}…`);
      }
    }
    return res.json();
  };

  const decide = (json) => {
    const v = getByPath(json, interpret?.path);
    switch (interpret?.op ?? "truthy") {
      case "truthy": return !!v;
      case "gt": return Number(v) > Number(interpret.value ?? 0);
      case "eq": return v === interpret.value;
      case "lt": return Number(v) < Number(interpret.value ?? 0);
      default: return !!v;
    }
  };

  const startedAt = new Date();
  const results = [];
  let ok = 0, fail = 0;

  for (const d of dates) {
    const url = buildUrl(d.checkIn, d.checkOut);
    try {
      const json = await runFetch(url);
      const occupied = decide(json);
      results.push({ id: d.id ?? d.checkIn, checkIn: d.checkIn, checkOut: d.checkOut, occupied, url, raw: json });
      ok++;
    } catch (err) {
      results.push({ id: d.id ?? d.checkIn, checkIn: d.checkIn, checkOut: d.checkOut, error: String(err), url });
      fail++;
    }
    if (throttleMs) await delay(throttleMs);
  }

  const endedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    ms: endedAt - startedAt,
    ok, fail, total: results.length,
    results
  };
}
