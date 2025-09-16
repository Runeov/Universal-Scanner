// server/browser.mjs
import { chromium } from 'playwright'
import { urlRegex } from './util.mjs'
import { summarizeArraysFromJson } from './array-summary.mjs'

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/129.0.0.0 Safari/537.36'

// Try a few waitUntil modes with shorter timeouts before giving up.
async function gotoResilient(page, url, timeoutMs) {
  const waits = ['domcontentloaded', 'commit', 'load']
  const timeouts = [
    Math.min(timeoutMs, 8000),
    Math.min(timeoutMs, 8000),
    timeoutMs,
  ]
  let lastErr
  for (let i = 0; i < waits.length; i++) {
    try {
      console.log(`[browser] goto ${url} waitUntil=${waits[i]} timeout=${timeouts[i]}`)
      await page.goto(url, { waitUntil: waits[i], timeout: timeouts[i] })
      return
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

/**
 * Heuristic classifier for "API-like" requests (JSON / GraphQL / XHR/fetch / api-ish paths).
 */
function classifyRequest(req, resInfo) {
  const url = req.url()
  const method = req.method()
  const rtype = req.resourceType()

  let contentType = ''
  if (resInfo?.headers) {
    contentType =
      (resInfo.headers['content-type'] ||
        resInfo.headers['Content-Type'] ||
        '').toLowerCase()
  }

  const pathname = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return ''
    }
  })()

  const isApiLikePath = /\b(api|graphql|gql|search|gateway|v\d+)\b/i.test(pathname)
  const isJson = contentType.includes('application/json') || contentType.includes('+json')
  const isGraphQL =
    /graphql|gql/i.test(url) ||
    (method === 'POST' &&
      /application\/json|application\/graphql/i.test(req.headers()['content-type'] || ''))
  const isXhrFetch = rtype === 'xhr' || rtype === 'fetch'

  return {
    apiCandidate: Boolean(isJson || isGraphQL || isXhrFetch || isApiLikePath),
    isJson,
    isGraphQL,
    isXhrFetch,
    isApiLikePath,
    contentType,
  }
}

/**
 * Lightweight helpers to produce a small, human-friendly summary of common JSON shapes.
 */
function pick(obj, keys) {
  const out = {}
  for (const k of keys) {
    const v = k.includes('.')
      ? k.split('.').reduce((o, p) => (o ? o[p] : undefined), obj)
      : obj[k]
    if (v !== undefined) out[k] = v
  }
  return out
}
function inferRoot(json) {
  if (json && typeof json === 'object' && Array.isArray(json.data)) return { root: json.data, path: 'data' }
  if (Array.isArray(json)) return { root: json, path: '$' }
  if (json && typeof json === 'object' && json.data && typeof json.data === 'object')
    return { root: [json.data], path: 'data(object)' }
  return { root: null, path: null }
}
function guessType(url, sample) {
  const p = (() => {
    try {
      return new URL(url).pathname.toLowerCase()
    } catch {
      return ''
    }
  })()
  if (sample && typeof sample === 'object') {
    if ('dateFrom' in sample || 'dateTo' in sample) return 'booking-ish'
    if ('price' in sample || 'location' in sample || 'maxGuests' in sample) return 'listing-ish'
  }
  if (/graphql|gql/.test(p)) return 'graphql'
  return 'json'
}
function
 summarizeJsonGenerically(url, json) {
  const { root, path } = inferRoot(json)
  if (!root || !Array.isArray(root) || root.length === 0) return null
  const kind = guessType(url, root[0])
  let cols
  if (root.some((x) => x && typeof x === 'object' && !Array.isArray(x))) {
    const colSet = new Set()
    for (const it of root.slice(0, 10)) {
      if (it && typeof it === 'object' && !Array.isArray(it)) {
        for (const k of Object.keys(it)) colSet.add(k)
      }
    }
    cols = Array.from(colSet).slice(0, 12)
  } else {
    cols = []
  }
  const sample = root.slice(0, 3).map((x) => (cols.length ? pick(x, cols) : x))
  return { kind, path, count: root.length, columns: cols, sample }
}

// Collect deep links from DOM (including shadow roots), filtered by optional allow patterns.
// Each link now carries its parent page (URL + title) so the UI can display "Parent ▶ Link".
async function collectDeepLinks(page, patterns = []) {
  return await page.evaluate((patterns) => {
    const seen = new Set()
    const out = []

    function collectFrom(root) {
      root.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href') || ''
        try {
          const abs = new URL(href, location.href).toString()
          if (seen.has(abs)) return
          if (patterns.length && !patterns.some((p) => abs.includes(p))) return
          seen.add(abs)
          out.push({
            href: abs,
            text: (a.textContent || '').trim(),
            source: 'dom',
            parent: location.href,
            parentTitle: document.title || '',
          })
        } catch {}
      })
      root.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) collectFrom(el.shadowRoot)
      })
    }

    const hintedRoots = [
      document,
      ...Array.from(document.querySelectorAll('[class*="grid-flow-col"][class*="grid-rows-2"]')),
      ...Array.from(document.querySelectorAll('[class*="mt-32"][class*="border-b"][class*="s-border"]')),
    ]
    hintedRoots.forEach((r) => collectFrom(r))
    return out
  }, patterns)
}

/**
 * Headless-browse a page and capture all XHR/Fetch/GraphQL requests,
 * plus summarize arrays from JSON responses (universal; no API docs needed).
 * Also collects "deep links" from the DOM to navigate further if desired.
 */
export async function browseAndCapture({
  url,
  headless = true,
  timeoutMs = 35000,
  maxRequests = 400,
  sameOrigin = true,
  autoScroll = true,
  storage,            // optional: { localStorageKey: value, ... } to pre-auth a SPA
  navAllowPatterns = [] // optional: array of substrings to whitelist deep links
}) {
  let browser = await chromium.launch({ headless })
  let context = await browser.newContext({
    userAgent: DESKTOP_UA,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    },
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'Europe/Oslo',
  })
  let page = await context.newPage()

  // Pre-seed localStorage (e.g., auth token/API key) *before* any scripts run.
  if (storage && typeof storage === 'object') {
    await context.addInitScript((kv) => {
      try {
        for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v)
      } catch {}
    }, storage)
  }

  // Accumulators
  const requests = []        // light index of all requests
  const apiCandidates = []
  const arraySummaries = []  // per-response array summaries (universal)
  let session = null

  // Try CDP to enrich initiators when available (best-effort)
  try {
    session = await context.newCDPSession(page)
    await session.send('Network.enable')
    session.on('Network.requestWillBeSent', (e) => {
      if (!e || !e.request) return
      const { requestId, request, initiator } = e
      requests.push({
        requestId,
        url: request.url,
        method: request.method,
        headers: request.headers,
        ts: Date.now(),
        frameUrl: e.documentURL || null,
        resourceType: e.type || null,
        initiator: initiator || null,
      })
    })
  } catch {
    // CDP not available; that's fine (Playwright events below still capture essentials)
  }

  // Attach listeners to a given Playwright Page instance.
  // Call once for the initial `page`, and again after any fallback that replaces `page`.
  function attachPageListeners(pg, { url, sameOrigin }) {
    // request index
    pg.on('request', (req) => {
      if (requests.length >= maxRequests) return
      try {
        requests.push({
          requestId: req.url() + ':' + Date.now(),
          url: req.url(),
          method: req.method(),
          headers: req.headers(),
          ts: Date.now(),
          frameUrl: req.frame()?.url() || null,
          resourceType: req.resourceType(),
          initiator: null,
        })
      } catch {}
    })

    // response capture (JSON → array summaries; API classification)
    pg.on('response', async (res) => {
      try {
        const req = res.request()
        const reqUrl = req.url()
        let reqOrigin = ''
        let seedOrigin = ''
        try {
          reqOrigin = new URL(reqUrl).origin
          seedOrigin = new URL(url).origin
        } catch {}

        if (sameOrigin && seedOrigin && reqOrigin && reqOrigin !== seedOrigin) return

        const headers = await res.headers()
        const status = res.status()
        const contentType =
          (headers['content-type'] || headers['Content-Type'] || '').toLowerCase()

        // Try to read JSON once and summarize universally
        let entitySummary = null

        if (contentType.includes('json')) {
          try {
            const txt = await res.text() // note: body can be read once
            try {
              const parsed = JSON.parse(txt)

              // UNIVERSAL array summaries for *any* JSON payload
              const arrs = summarizeArraysFromJson(parsed, {
                minArrayLength: 1,
                maxItemsToSample: 5,
              })
              for (const a of arrs) {
                arraySummaries.push({
                  atUrl: req.url(),
                  method: req.method(),
                  ...a,
                })
              }

              // Small generic "entity" summary (nice for eyeballing captures)
              entitySummary = summarizeJsonGenerically(req.url(), parsed)
            } catch {}
          } catch {
            // ignore
          }
        }

        // Classify as API-like?
        const cls = classifyRequest(req, { headers })
        if (cls.apiCandidate) {
          // GraphQL POST body peek for opName/snippet (best-effort)
          let opName = null
          let graphQLQuery = null
          if (cls.isGraphQL && req.method() === 'POST') {
            try {
              const body = req.postData() || ''
              if (/^[\[{]/.test(body.trim())) {
                const parsed = JSON.parse(body)
                const first = Array.isArray(parsed) ? parsed[0] : parsed
                opName = first?.operationName || null
                graphQLQuery =
                  typeof first?.query === 'string' ? first.query.slice(0, 120) : null
              } else if (/\bquery\s+|\bmutation\s+/i.test(body)) {
                graphQLQuery = body.slice(0, 120)
              }
            } catch {}
          }

          apiCandidates.push({
            url: req.url(),
            method: req.method(),
            resourceType: req.resourceType(),
            frameUrl: req.frame()?.url() || null,
            contentType: cls.contentType || null,
            isJson: cls.isJson,
            isGraphQL: cls.isGraphQL,
            isXhrFetch: cls.isXhrFetch,
            isApiLikePath: cls.isApiLikePath,
            status,
            opName,
            graphQLQuery,
            entitySummary,
          })
        }
      } catch {
        // ignore per-response errors; keep scanning
      }
    })
  } // end attachPageListeners

  // ✅ Call it on the initial page (before any navigation):
  attachPageListeners(page, { url, sameOrigin })

 // ---- Robust navigation with retry & HTTP/2 and headful fallbacks ----
async function launchContext({ disableHttp2 = false, forceHeadful = false } = {}) {
  const browser2 = await chromium.launch({
    headless: !forceHeadful,
    args: [
      ...(disableHttp2 ? ['--disable-http2'] : []),
      ...(forceHeadful ? ['--disable-blink-features=AutomationControlled'] : []),
    ],
  })
  const context2 = await browser2.newContext({
    userAgent: DESKTOP_UA,            // defined at top of file
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    },
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'Europe/Oslo',
  })
  // optional stealth (define applyStealth(ctx) earlier if you use it)
  if (typeof applyStealth === 'function') {
    await applyStealth(context2)
  }
  const page2 = await context2.newPage()
  return { browser2, context2, page2 }
}

// First try: current browser/context (headless)
let gotoOk = false
try {
  await gotoResilient(page, url, timeoutMs)
  gotoOk = true
} catch (e1) {
  const msg = String((e1 && e1.message) || e1)

  // DNS typo? Bail with a clear message.
  if (msg.includes('ERR_NAME_NOT_RESOLVED')) {
    throw new Error(`DNS_RESOLUTION_FAILED: ${url} — check the hostname (typo?)`)
  }

  // Fallback 1: HTTP/2 flake → retry once forcing HTTP/1.1 (still headless)
  if (!gotoOk && msg.includes('ERR_HTTP2_PROTOCOL_ERROR')) {
    try {
      try { await context.close() } catch {}
      try { await browser.close() } catch {}

      const { browser2, context2, page2 } = await launchContext({ disableHttp2: true })
      browser = browser2
      context = context2
      page = page2

      // re-bind network listeners on the NEW page
      attachPageListeners(page, { url, sameOrigin })

      // (best-effort) recreate CDP session for initiators
      try {
        session = await context.newCDPSession(page)
        await session.send('Network.enable')
        session.on('Network.requestWillBeSent', (e) => {
          if (!e || !e.request) return
          const { requestId, request, initiator } = e
          requests.push({
            requestId,
            url: request.url,
            method: request.method,
            headers: request.headers,
            ts: Date.now(),
            frameUrl: e.documentURL || null,
            resourceType: e.type || null,
            initiator: initiator || null,
          })
        })
      } catch {}

      await gotoResilient(page, url, timeoutMs)
      gotoOk = true
      console.log('[browser] retried with --disable-http2 and succeeded')
    } catch (e2) {
      console.error('[browser] retry with --disable-http2 failed:', e2)
      // proceed to headful fallback
    }
  }

  // Fallback 2: final headful retry (also disables HTTP/2)
  if (!gotoOk) {
    try {
      try { await context.close() } catch {}
      try { await browser.close() } catch {}

      const { browser2, context2, page2 } = await launchContext({ disableHttp2: true, forceHeadful: true })
      browser = browser2
      context = context2
      page = page2

      attachPageListeners(page, { url, sameOrigin })

      await gotoResilient(page, url, timeoutMs)
      gotoOk = true
      console.log('[browser] retried headful (HTTP/1.1) and succeeded')
    } catch (e3) {
      console.error('[browser] headful fallback failed:', e3)
      throw e1 // rethrow original error for clarity
    }
  }
}

if (!gotoOk) throw new Error('Navigation failed')



  // Best-effort consent auto-dismiss (e.g., FINN CMP)
  await page
    .getByRole('button', { name: /Godta alle|Accept all|Agree|OK/i })
    .click({ timeout: 1500 })
    .catch(() => {})
  await page
    .locator('button.message-button.primary, .sp_choice_type_11, [data-choice], .message-button')
    .first()
    .click({ timeout: 1500 })
    .catch(() => {})

  try {
    await page.waitForLoadState('networkidle', { timeout: 4000 })
  } catch {}

  if (autoScroll) {
    try {
      await page.evaluate(async () => {
        await new Promise((res) => {
          let y = 0
          const maxY = 3000
          const step = 300
          const id = setInterval(() => {
            y += step
            window.scrollTo({ top: y, behavior: 'instant' })
            if (y >= maxY) {
              clearInterval(id)
              res()
            }
          }, 200)
        })
      })
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
    } catch {}
  }

  // Extract visible, static URL-like strings from DOM (optional but handy)
  const domText = await page.content()
  const domUrls = Array.from(domText.matchAll(urlRegex)).map((m) => m[0])

  // Collect deep links from relevant DOM areas (grid & category rows + global), with optional allow patterns
  const deepLinks = await collectDeepLinks(page, Array.isArray(navAllowPatterns) ? navAllowPatterns : [])

  let pageTitle = ''
  try { pageTitle = await page.title() } catch {}

  await browser.close()

  // Per-host summary for API candidates
  const byHost = {}
  for (const r of apiCandidates) {
    try {
      const h = new URL(r.url).host
      byHost[h] = (byHost[h] || 0) + 1
    } catch {}
  }

  return {
    summary: {
      seedUrl: url,
      apiCandidates: apiCandidates.length,
      totalRequests: requests.length,
    },
    apiCandidates,
    domUrls,
    byHost,
    arraySummaries, // UNIVERSAL: arrays found in JSON responses at runtime
    deepLinks,
    pageTitle,
  }
}
