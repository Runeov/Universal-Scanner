// server/index.mjs
import express from 'express'
import cors from 'cors'
import { scanSite } from './scan.mjs'
import { browseAndCapture } from './browser.mjs'
import { writeScanArtifacts } from './filelog.mjs'

// Boot-time diagnostics for export paths
console.log('[server] cwd =', process.cwd())
console.log('[server] LOG_DIR =', process.env.LOG_DIR || '(not set)')

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// ---------- helpers for merging ----------
function unionBy(arrA = [], arrB = [], keyFn) {
  const map = new Map()
  for (const x of arrA) map.set(keyFn(x), x)
  for (const y of arrB) map.set(keyFn(y), y)
  return Array.from(map.values())
}
function sumByHost(a = {}, b = {}) {
  const out = { ...a }
  for (const [h, c] of Object.entries(b || {})) out[h] = (out[h] || 0) + c
  return out
}
function mergeResults(base = {}, add = {}) {
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

// ---------- main scan endpoint ----------
app.post('/api/scan', async (req, res) => {
  try {
    const {
      url,
      maxDepth = 1,
      sameOrigin = true,
      maxPages = 20,
      timeoutMs = 15000,
      mode = 'http', // 'http' | 'browser' | 'both'
      exportLogs,
      exportFormats,
      exportDir,
      navAllowPatterns,
      storage, // optional: localStorage pre-seed for SPAs
    } = req.body || {}

    if (!url) return res.status(400).json({ error: 'Missing url' })

    console.log('[scan] incoming', {
      url,
      maxDepth,
      sameOrigin,
      maxPages,
      timeoutMs,
      mode,
      exportLogs,
      exportFormats,
      exportDir,
      navAllowPatterns,
      hasStorage: !!storage,
    })

    // Base HTTP scan
    const base = await scanSite({
      seedUrl: url,
      maxDepth: Number(maxDepth),
      sameOrigin: Boolean(sameOrigin),
      maxPages: Number(maxPages),
      timeoutMs: Number(timeoutMs),
    })

    // HTTP-only mode
    if (mode === 'http') {
      let output = base
      if (exportLogs) {
        const formats = Array.isArray(exportFormats) ? exportFormats : ['json', 'ndjson']
        try {
          console.log('[scan] exporting (http) with formats', formats, 'dir', exportDir || '(default)')
          const exported = await writeScanArtifacts(output, { formats, dir: exportDir })
          output = { ...output, exported }
          console.log('[scan] export OK (http)', exported)
        } catch (e) {
          console.error('[scan] export FAIL (http)', e)
          output = { ...output, exportError: String(e) }
        }
      }
      return res.json(output)
    }

    // Headless browser capture
    const browserPart = await browseAndCapture({
      url,
      headless: true,
      timeoutMs: Math.max(Number(timeoutMs), 25000),
      sameOrigin: Boolean(sameOrigin),
      autoScroll: true,
      navAllowPatterns,
      storage,
    })

    // Browser-only mode
    if (mode === 'browser') {
      let output = { browser: browserPart, summary: { seedUrl: url, browserApiCandidates: browserPart.summary.apiCandidates, browserTotalRequests: browserPart.summary.totalRequests } }
      if (exportLogs) {
        const formats = Array.isArray(exportFormats) ? exportFormats : ['json', 'ndjson']
        try {
          console.log('[scan] exporting (browser) with formats', formats, 'dir', exportDir || '(default)')
          const exported = await writeScanArtifacts(output, { formats, dir: exportDir })
          output = { ...output, exported }
          console.log('[scan] export OK (browser)', exported)
        } catch (e) {
          console.error('[scan] export FAIL (browser)', e)
          output = { ...output, exportError: String(e) }
        }
      }
      return res.json(output)
    }

    // Both: merge base + browser info
    const merged = {
      ...base,
      browser: browserPart,
      summary: {
        ...base.summary,
        browserApiCandidates: browserPart.summary.apiCandidates,
        browserTotalRequests: browserPart.summary.totalRequests,
      },
      byHost: {
        ...base.byHost,
        ...browserPart.byHost,
      },
    }

    let output = merged
    if (exportLogs) {
      const formats = Array.isArray(exportFormats) ? exportFormats : ['json', 'ndjson']
      try {
        console.log('[scan] exporting (both) with formats', formats, 'dir', exportDir || '(default)')
        const exported = await writeScanArtifacts(output, { formats, dir: exportDir })
        output = { ...output, exported }
        console.log('[scan] export OK (both)', exported)
      } catch (e) {
        console.error('[scan] export FAIL (both)', e)
        output = { ...output, exportError: String(e) }
      }
    }
    return res.json(output)
  } catch (err) {
    console.error('[scan] fatal', err)
    res.status(500).json({ error: String(err && err.stack || err) })
  }
})

// ---------- queue/merge endpoint with nav trail ----------
app.post('/api/queue-scan', async (req, res) => {
  try {
    const {
      base,                 // optional: existing result to merge into
      links = [],           // [{href, from?, label?}] or ["https://..."]
      sameOrigin = true,
      maxDepth = 0,
      maxPages = 6,
      timeoutMs = 15000,
      mode = 'both',        // http | browser | both
      navAllowPatterns = [],
      storage,              // optional: localStorage pre-seed
    } = req.body || {}

    if (!Array.isArray(links) || links.length === 0) {
      return res.status(400).json({ error: 'links[] required' })
    }

    let merged = base || {}
    const navTrail = []

    // process links sequentially (polite)
    for (const raw of links.slice(0, 25)) {
      const href = typeof raw === 'string' ? raw : raw.href
      const from =
        typeof raw === 'string'
          ? (base?.summary?.seedUrl || '')
          : (raw.from || base?.summary?.seedUrl || '')
      if (!href) continue

      // HTTP pass
      const httpPart = await scanSite({
        seedUrl: href,
        maxDepth: Number(maxDepth),
        sameOrigin: Boolean(sameOrigin),
        maxPages: Number(maxPages),
        timeoutMs: Number(timeoutMs),
      })

      // Optional browser pass
      let browserPart = null
      if (mode === 'both' || mode === 'browser') {
        browserPart = await browseAndCapture({
          url: href,
          headless: true,
          timeoutMs: Math.max(Number(timeoutMs), 25000),
          sameOrigin: Boolean(sameOrigin),
          autoScroll: true,
          navAllowPatterns,
          storage,
        })
      }

      const perLink =
        mode === 'http'
          ? httpPart
          : mode === 'browser'
            ? {
                browser: browserPart,
                summary: {
                  seedUrl: href,
                  browserApiCandidates: browserPart?.summary?.apiCandidates || 0,
                  browserTotalRequests: browserPart?.summary?.totalRequests || 0,
                },
                byHost: browserPart?.byHost || {},
              }
            : {
                ...httpPart,
                browser: browserPart,
                summary: {
                  ...(httpPart.summary || {}),
                  browserApiCandidates: browserPart?.summary?.apiCandidates || 0,
                  browserTotalRequests: browserPart?.summary?.totalRequests || 0,
                },
                byHost: sumByHost(httpPart.byHost, browserPart?.byHost || {}),
              }

      // Nav edge
      navTrail.push({
        from,
        to: href,
        pageTitle: browserPart?.pageTitle || '',
        kind: mode,
        when: new Date().toISOString(),
      })
      perLink.navTrail = navTrail.slice(-1)

      // Merge
      merged = mergeResults(merged, perLink)
    }

    return res.json(merged)
  } catch (err) {
    console.error('[queue-scan] fatal', err)
    res.status(500).json({ error: String(err && err.stack || err) })
  }
})

const PORT = process.env.PORT || 5174
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`)
})
