export const name = 'booking';

const STRONG_PATH = /(searchresults|availability|blockavailability|srp|availability\.)/i;

export function match(url = '') {
  try {
    const h = new URL(url).hostname;
    return /(^|\.)booking\.com$/i.test(h);
  } catch { return false; }
}

export function discoverFromScan(scan, { REQUEST_KEY_HINTS }) {
  const out = [];
  const add = (url, method = 'GET', score = 0) => out.push({ url, method, score });

  // endpoints
  if (Array.isArray(scan.endpoints)) {
    scan.endpoints.forEach((e) => {
      if (!e?.url) return;
      if (!match(e.url)) return;
      let score = 0;
      if (STRONG_PATH.test(e.url)) score += 3;
      if (/checkin|checkout|group_adults|dest_id/i.test(e.url)) score += 2;
      add(e.url, e.method || 'GET', score);
    });
  }
  // browser api candidates
  const cands = scan?.browser?.apiCandidates || [];
  cands.forEach((c) => {
    if (!c?.url) return;
    if (!match(c.url)) return;
    let score = 1;
    if (STRONG_PATH.test(c.url)) score += 3;
    if (/checkin|checkout|group_adults|dest_id/i.test(c.url)) score += 2;
    add(c.url, c.method || 'GET', score);
  });
  // deep links
  const dls = scan?.browser?.deepLinks || [];
  dls.forEach((l) => {
    if (!l?.href) return;
    if (!match(l.href)) return;
    let score = 0;
    if (STRONG_PATH.test(l.href)) score += 2;
    if (/checkin|checkout|group_adults|dest_id/i.test(l.href)) score += 1;
    add(l.href, 'GET', score);
  });

  return out;
}

export function suggestParamMapFromUrl(url, REQUEST_KEY_HINTS) {
  const u = new URL(url);
  const keys = Array.from(u.searchParams.keys()).map((k) => k.toLowerCase());
  const find = (alts) => keys.find((k) => alts.includes(k));
  const H = REQUEST_KEY_HINTS;

  const checkIn = find(H.checkIn.map((s) => s.toLowerCase())) || 'checkin';
  const checkOut = find(H.checkOut.map((s) => s.toLowerCase())) || 'checkout';
  const adults = find((H.adults || []).map((s) => s.toLowerCase())) || 'group_adults';
  const venueId = find(['dest_id','hotel_id','aid']) || 'dest_id';
  const children = find((H.children || []).map((s) => s.toLowerCase())) || 'group_children';

  return { checkIn, checkOut, adults, children, venueId };
}

// Best-effort interpreter for Booking-ish JSON blobs (site runtime/captured endpoints)
export function interpret(json) {
  if (!json || typeof json !== 'object') return null;

  // 1) New(er) SRP JSON shapes (hypothetical/captured)
  // If we see 'soldOut' or 'availability' flags:
  const flat = JSON.stringify(json).toLowerCase();

  // If soldout flags are present
  if (/soldout/.test(flat)) {
    const sold = /"soldout"\s*:\s*true/.test(flat);
    return { occupied: !sold, rawPreview: pickPreview(json) };
  }

  // Block availability (Booking APIs / observed browser JSON)
  // Look for objects that contain "max_occupancy" and "max_adults"
  if (json.block || json.blocks || json.blockAvailability) {
    const blocks = json.block || json.blocks || json.blockAvailability || [];
    let anyAvail = false;
    let price = null;
    let rating = null;
    let roomType = null;

    const arr = Array.isArray(blocks) ? blocks : Object.values(blocks);
    for (const b of arr) {
      // availability hints
      const sold = b?.sold_out === true || b?.availability === 0;
      if (!sold) anyAvail = true;
      // price hints
      const p = b?.min_total_price ?? b?.price ?? b?.priceBreakdown?.grossPrice?.value ?? null;
      if (p != null && price == null) price = Number(p);
      // room type text
      roomType = roomType || b?.name || b?.room_name || null;
      // rating (if present in a parent maybe, leave null otherwise)
    }
    return { occupied: anyAvail, price, rating, roomType, rawPreview: pickPreview(json) };
  }

  // Generic: consider presence of "availability" numeric
  const availNum = findFirstNumberByKeys(json, ['availability', 'roomsAvailable', 'freeRooms']);
  if (typeof availNum === 'number') {
    return { occupied: availNum > 0, price: findFirstNumberByKeys(json, ['price','min_total_price']), rawPreview: pickPreview(json) };
  }

  return { occupied: false, rawPreview: pickPreview(json) };
}

// helpers
function pickPreview(obj) {
  try {
    // compact preview: first-level keys and small sub-sample
    const keys = Object.keys(obj).slice(0, 6);
    const prev = {};
    keys.forEach((k) => { prev[k] = obj[k]; });
    return prev;
  } catch { return null; }
}
function findFirstNumberByKeys(obj, keyList) {
  for (const k of keyList) {
    if (obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = obj[k];
      if (typeof v === 'number') return v;
    }
  }
  return null;
}