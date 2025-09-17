import express from 'express';

// ---------- helpers for merging ----------
export function unionBy(arrA = [], arrB = [], keyFn) {
  const map = new Map()
  for (const x of arrA) map.set(keyFn(x), x)
  for (const y of arrB) map.set(keyFn(y), y)
  return Array.from(map.values())
}
export function sumByHost(a = {}, b = {}) {
  const out = { ...a }
  for (const [h, c] of Object.entries(b || {})) out[h] = (out[h] || 0) + c
  return out
}
export function mergeResults(base = {}, add = {}) {
  const out = { ...base }

// Summary (recompute some totals loosely)
  out.summary = {
    ...(out.summary || {}),
    seedUrl: out.summary?.seedUrl || add.summary?.seedUrl || '',
    pagesScanned: (out.summary?.pagesScanned || 0) + (add.summary?.pagesScanned || 0),
    endpointsFound: (out.summary?.endpointsFound || 0) + (add.summary?.endpointsFound || 0),
    imagesFound: (out.summary?.imagesFound || 0) + (add.summary?.imagesFound || 0),
    browserApiCandidates:
      (out.summary?.browserApiCandidates || 0) +
      (add.summary?.browserApiCandidates || add.browser?.summary?.apiCandidates || 0),
    browserTotalRequests:
      (out.summary?.browserTotalRequests || 0) +
      (add.summary?.browserTotalRequests || add.browser?.summary?.totalRequests || 0),
  }

  // Flat unions
  out.endpoints = unionBy(out.endpoints || [], add.endpoints || [], (e) => e.url)
  out.images = unionBy(out.images || [], add.images || [], (s) => s)
  out.provenance = unionBy(out.provenance || [], add.provenance || [], (p) => p.imageUrl)
  out.selfDescribing = unionBy(
    out.selfDescribing || [],
    add.selfDescribing || [],
    (s) => `${s.url}|${s.info?.kind || ''}|${s.info?.meta || ''}`
  )
  out.arrays = unionBy(
    out.arrays || [],
    add.arrays || [],
    (a) => `${a.sourceUrl || ''}|${a.path}`
  )

  // By host
  out.byHost = sumByHost(out.byHost, add.byHost)

  // Logs
  out.logs = [...(out.logs || []), ...(add.logs || [])]

  // Browser subtree (tolerate browser-only payloads)
  const aB = add.browser || add
  if (aB && (aB.apiCandidates || aB.arraySummaries || aB.deepLinks)) {
    out.browser = out.browser || {
      apiCandidates: [],
      arraySummaries: [],
      byHost: {},
      deepLinks: [],
    }
    if (aB.apiCandidates) {
      out.browser.apiCandidates = unionBy(
        out.browser.apiCandidates || [],
        aB.apiCandidates || [],
        (r) => `${r.method}|${r.url}|${r.status}`
      )
    }
    if (aB.arraySummaries) {
      out.browser.arraySummaries = unionBy(
        out.browser.arraySummaries || [],
        aB.arraySummaries || [],
        (s) => `${s.atUrl}|${s.path}`
      )
    }
    if (aB.byHost) {
      out.browser.byHost = sumByHost(out.browser.byHost, aB.byHost)
    }
    if (aB.deepLinks) {
      out.browser.deepLinks = unionBy(
        out.browser.deepLinks || [],
        aB.deepLinks || [],
        (l) => l.href || JSON.stringify(l)
      )
    }
    if (aB.pageTitle && !out.pageTitle) out.pageTitle = aB.pageTitle
  }

  // Nav trail (append)
  if (add.navTrail && add.navTrail.length) {
    out.navTrail = [...(out.navTrail || []), ...add.navTrail]
  }

  return out
}