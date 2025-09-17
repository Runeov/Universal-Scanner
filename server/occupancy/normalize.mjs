// server/occupancy/normalize.mjs
export function normalizeRating10(v) {
  if (v == null) return null;
  // handle 0–5 stars, 0–100, 1–10, etc.
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  if (n <= 5) return Math.max(0, Math.min(10, (n / 5) * 10));
  if (n <= 100) return Math.max(0, Math.min(10, n / 10));
  return Math.max(0, Math.min(10, n)); // already 1–10
}

export function bucketRoomType(name = '') {
  const s = String(name).toLowerCase();
  if (/junior\s*suite/.test(s)) return 'junior suite';
  if (/suite/.test(s)) return 'suite';
  if (/apartment|apt/.test(s)) {
    if (/\b(studio)\b/.test(s)) return 'apartment (studio)';
    if (/\b1\b|\bone\b/.test(s)) return 'apartment (1br)';
    if (/\b2\b|\btwo\b/.test(s)) return 'apartment (2br+)';
    return 'apartment';
  }
  if (/cabin|chalet/.test(s)) return 'cabin';
  if (/deluxe/.test(s)) return 'deluxe';
  if (/standard|classic|superior/.test(s)) return 'standard';
  if (/single|twin|queen|double|king|triple/.test(s)) {
    if (/single/.test(s)) return 'single';
    if (/triple/.test(s)) return 'triple';
    if (/double|queen|king|twin/.test(s)) return 'double';
  }
  return 'other';
}

export const buildDatesISO = {
  addNights(ci, nights = 1) {
    const d = new Date(ci);
    if (Number.isNaN(+d)) return ci;
    const out = new Date(d);
    out.setDate(out.getDate() + Number(nights || 1));
    return out.toISOString().slice(0, 10);
  },
};
