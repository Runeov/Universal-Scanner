// server/booking-srp.mjs

// Is a URL hosted on booking.com?
export function isBookingHost(u) {
  try {
    const host = new URL(u).host;
    return /\.booking\.com$/i.test(host);
  } catch {
    return false;
  }
}

// Wait for SRP results to be present: either a JSON response or visible result elements.
export async function waitForBookingSrpReady(page, timeout = 10000) {
  const ok = await Promise.race([
    page.waitForResponse(async (resp) => {
      try {
        const u = resp.url();
        if (!isBookingHost(u)) return false;
        const ct = (resp.headers()['content-type'] || '').toLowerCase();
        return /json/.test(ct) && /(graphql|search|results|availability)/i.test(u);
      } catch { return false; }
    }, { timeout }),
    page.locator(
      '[data-testid="property-card"], [data-hotelid], [data-testid="result-info"], [data-testid="results-subheader"], [aria-live]'
    ).first().waitFor({ state: 'visible', timeout })
  ]).catch(() => null);
  return ok != null;
}

// Parse Booking SRP JSON payloads for totals and hotel IDs.
export function harvestBookingFromJson(parsed, reqUrl, { searchTotals, universeIdSet }) {
  if (!isBookingHost(reqUrl)) return;

  const total =
    parsed?.searchResults?.totalResults ??
    parsed?.data?.search?.results?.total ??
    parsed?.data?.search?.meta?.total ??
    parsed?.total ?? null;

  const hotelList =
    parsed?.data?.search?.results?.items ??
    parsed?.searchResults?.items ??
    parsed?.hotels ?? [];

  if (Number.isFinite(total)) {
    searchTotals.push({
      atUrl: reqUrl,
      when: new Date().toISOString(),
      total
    });
  }

  for (const it of hotelList) {
    const id = it?.hotel_id ?? it?.id ?? it?.hotelId ?? it?.uid ?? null;
    if (id != null) universeIdSet.add(String(id));
  }
}

// DOM fallbacks to capture total count and hotel IDs if JSON wasn’t observed.
export async function collectBookingDomFallbacks(page, searchTotals, universeIdSet) {
  try {
    if (!isBookingHost(page.url())) return;

    // Visible headers: "X properties" / "X results"
    const domTotal = await page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll(
        'h1, h2, [data-testid="result-info"], [data-testid="results-subheader"], [aria-live], #search_results_table .sr_header h1'
      )).map(el => el.textContent || '').join(' | ');
      const m = texts.match(/(\d[\d\s,\.]*)\s+(?:properties|results|hotels)/i);
      if (m) return Number(m[1].replace(/[^\d]/g, ''));
      const attr = document.querySelector('[data-total-count]')?.getAttribute('data-total-count');
      return attr ? Number(attr.replace(/[^\d]/g, '')) : null;
    });

    if (domTotal != null && Number.isFinite(domTotal) && domTotal >= 0) {
      searchTotals.push({ atUrl: page.url(), when: new Date().toISOString(), total: domTotal });
    }

    // Collect hotel IDs from DOM
    const domIds = await page.evaluate(() => {
      const set = new Set();
      document.querySelectorAll('[data-hotelid]').forEach(n => set.add(n.getAttribute('data-hotelid')));
      document.querySelectorAll('[data-testid="property-card"]').forEach(n => {
        const id = n.getAttribute('data-hotel-id') ||
                   n.querySelector('[data-hotelid]')?.getAttribute('data-hotelid');
        if (id) set.add(id);
      });
      return Array.from(set);
    });

    for (const id of domIds) universeIdSet.add(String(id));
  } catch {
    // swallow DOM fallback errors silently
  }
}
