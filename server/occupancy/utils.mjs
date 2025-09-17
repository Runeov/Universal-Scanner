// server/occupancy/utils.mjs
import { REQUEST_KEY_HINTS } from './hints.mjs';

export function extractEndpointsFromScan(scan = {}) {
  const out = [];
  (scan.endpoints || []).forEach((e) => e?.url && out.push({
    url: e.url, method: e.method || 'GET', contentType: e.contentType || ''
  }));
  (scan.browser?.apiCandidates || []).forEach((c) => c?.url && out.push({
    url: c.url, method: c.method || 'GET', contentType: c.contentType || ''
  }));
  (scan.browser?.deepLinks || []).forEach((l) => l?.href && out.push({
    url: l.href, method: 'GET', contentType: ''
  }));
  return out;
}

export function scoreCandidateGeneric(e, { hints }) {
  let s = 0;
  if (/availability|searchresults|search|rooms|block/i.test(e.url)) s += 2;
  if (/\?/.test(e.url)) {
    const u = new URL(e.url);
    const keys = Array.from(u.searchParams.keys()).map((k) => k.toLowerCase());
    const has = (arr) => arr.some((a) => keys.includes(a.toLowerCase()));
    if (has(hints.checkIn)) s += 2;
    if (has(hints.checkOut)) s += 2;
    if (has(hints.adults)) s += 1;
  }
  return s;
}

export function suggestParamMapFromUrl(url, H = REQUEST_KEY_HINTS) {
  const u = new URL(url);
  const keys = Array.from(u.searchParams.keys()).map((k) => k.toLowerCase());
  const find = (alts) => keys.find((k) => alts.map((s) => s.toLowerCase()).includes(k));
  return {
    checkIn:  find(H.checkIn)    || 'checkin',
    checkOut: find(H.checkOut)   || 'checkout',
    adults:   find(H.adults)     || 'adults',
    children: find(H.children || []) || 'children',
    venueId:  find(['dest_id','hotel_id','property_id','place_id','city']) || null,
  };
}

export function buildUrlWithParams(base, opts) {
  const {
    checkInKey, checkOutKey, adultsKey, childrenKey, venueIdKey,
    checkIn, checkOut, adults, children, venueId, extra = {},
  } = opts || {};

  const u = new URL(base);
  const set = (k, v) => { if (k && v != null && v !== '') u.searchParams.set(k, String(v)); };

  set(checkInKey,  checkIn);
  set(checkOutKey, checkOut);
  set(adultsKey,   adults);
  if (childrenKey) set(childrenKey, children);
  if (venueIdKey)  set(venueIdKey,  venueId);

  Object.entries(extra || {}).forEach(([k, v]) => set(k, v));
  return u.toString();
}

export function safeJson(text) {
  try {
    const t = (text || '').trim();
    if (!t) return null;
    return JSON.parse(t);
  } catch { return null; }
}
