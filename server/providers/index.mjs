// server/providers/index.mjs
import * as booking from './booking.mjs';

export const adapters = [
  booking, // add more later
];

export function providerNameForUrl(url = '') {
  try {
    const h = new URL(url).hostname;
    if (/booking\.com$/i.test(h) || /(^|\.)booking\.com$/i.test(h)) return 'booking';
  } catch {}
  return 'generic';
}

export function pickAdapterByUrl(url = '') {
  const name = providerNameForUrl(url);
  return adapters.find((a) => a.name === name) || null;
}


