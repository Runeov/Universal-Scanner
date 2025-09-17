// server/utils/normalize-ui.mjs

/**
 * Normalize payload so the UI always gets the keys it expects.
 * Safe for HTTP-only, browser-only, or merged payloads.
 */
export function normalizeForUI(payload = {}) {
  const out = { ...payload };

  // Summary
  out.summary = {
    seedUrl: out.summary?.seedUrl || payload.seedUrl || '',
    pagesScanned: out.summary?.pagesScanned || 0,
    endpointsFound: out.summary?.endpointsFound || 0,
    imagesFound: out.summary?.imagesFound || 0,
    browserApiCandidates:
      out.summary?.browserApiCandidates ??
      out.browser?.summary?.apiCandidates ??
      out.browser?.summary?.browserApiCandidates ??
      0,
    browserTotalRequests:
      out.summary?.browserTotalRequests ??
      out.browser?.summary?.totalRequests ??
      out.browser?.summary?.browserTotalRequests ??
      0,
  };

  // Browser subtree
  const b = out.browser || {};
  out.browser = {
    ...b,
    arraySummaries: Array.isArray(b.arraySummaries) ? b.arraySummaries : [],
    apiCandidates: Array.isArray(b.apiCandidates) ? b.apiCandidates : [],
    deepLinks: Array.isArray(b.deepLinks) ? b.deepLinks : [],
    byHost: b.byHost || {},
    summary: b.summary || {},
  };

  // Collections
  out.endpoints = Array.isArray(out.endpoints) ? out.endpoints : [];
  out.arrays = Array.isArray(out.arrays) ? out.arrays : [];
  out.images = Array.isArray(out.images) ? out.images : [];
  out.provenance = Array.isArray(out.provenance) ? out.provenance : [];
  out.selfDescribing = Array.isArray(out.selfDescribing) ? out.selfDescribing : [];

  // Misc
  if (!Array.isArray(out.navTrail)) out.navTrail = [];
  out.byHost = out.byHost || {};

  return out;
}
