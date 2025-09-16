// server/browser.mjs
import { chromium } from 'playwright'
import { urlRegex } from './util.mjs'
import { summarizeArraysFromJson } from './array-summary.mjs'
import {
  waitForBookingSrpReady,
  harvestBookingFromJson,
  collectBookingDomFallbacks,
} from './booking-srp.mjs'

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

async function applyStealth(ctx) {
  await ctx.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
      window.chrome = window.chrome || { runtime: {} }
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' })
      const orig = navigator.permissions && navigator.permissions.query
      if (orig) {
        navigator.permissions.query = (p) =>
          p && p.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : orig(p)
      }
    } catch {}
  })
}

async function gotoResilient(page, url, opts = {}) {
  const waits = opts.waits || ['domcontentloaded', 'commit', 'load']
  const timeouts = opts.timeouts || [8000, 8000, 25000]
  let lastErr
  for (let i = 0; i < waits.length; i++) {
    const to = timeouts[i] != null ? timeouts[i] : timeouts[timeouts.length - 1]
    try {
      console.log(`[browser] goto ${url} waitUntil=${waits[i]} timeout=${to}`)
      await page.goto(url, { waitUntil: waits[i], timeout: to })
      return
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

function classifyRequest(req, resInfo) {
  const url = req.url()
  const method = req.method()
  const rtype = req.resourceType()
  const ct = (resInfo?.headers?.['content-type'] || resInfo?.headers?.['Content-Type'] || '').toLowerCase()
  let path = ''
  try { path = new URL(url).pathname } catch {}
  const isApiPath = /\b(api|graphql|gql|search|results|availability|gateway|v\d+)\b/i.test(path)
  return {
    apiCandidate: Boolean(ct.includes('json') || /\+json/.test(ct) || rtype === 'xhr' || rtype === 'fetch' || isApiPath),
    isJson: ct.includes('json') || /\+json/.test(ct),
    isGraphQL: /graphql|gql/i.test(url) || (method === 'POST' && /application\/(json|graphql)/i.test(req.headers()['content-type'] || '')),
    isXhrFetch: rtype === 'xhr' || rtype === 'fetch',
    isApiLikePath: isApiPath,
    contentType: ct,
  }
}

function pick(obj, keys) {
  const out = {}
  for (const k of keys) {
    const v = k.includes('.') ? k.split('.').reduce((o, p) => (o ? o[p] : undefined), obj) : obj[k]
    if (v !== undefined) out[k] = v
  }
  return out
}
function inferRoot(json) {
  if (json && typeof json === 'object' && Array.isArray(json.data)) return { root: json.data, path: 'data' }
  if (Array.isArray(json)) return { root: json, path: '$' }
  if (json && typeof json === 'object' && json.data && typeof json.data === 'object') return { root: [json.data], path: 'data(object)' }
  return { root: null, path: null }
}
function summarizeJsonGenerically(url, json) {
  const { root, path } = inferRoot(json)
  if (!root || !Array.isArray(root) || root.length === 0) return null
  let cols
  if (root.some((x) => x && typeof x === 'object' && !Array.isArray(x))) {
    const set = new Set()
    for (const it of root.slice(0, 10)) if (it && typeof it === 'object' && !Array.isArray(it)) Object.keys(it).forEach((k) => set.add(k))
    cols = Array.from(set).slice(0, 12)
  } else cols = []
  return { kind: 'json', path, count: root.length, columns: cols, sample: root.slice(0, 3).map((x) => (cols.length ? pick(x, cols) : x)) }
}

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
          out.push({ href: abs, text: (a.textContent || '').trim(), parent: location.href, parentTitle: document.title || '' })
        } catch {}
      })
      root.querySelectorAll('*').forEach((el) => el.shadowRoot && collectFrom(el.shadowRoot))
    }
    ;[document].forEach((r) => collectFrom(r))
    return out
  }, patterns)
}

export async function browseAndCapture({
  url,
  headless = true,
  timeoutMs = 35000,
  maxRequests = 400,
  sameOrigin = true,
  autoScroll = true,
  storage,
  navAllowPatterns = [],
  preferHttp1 = false,
  forceHeadful = false,
  navQuick = false,
  fastMode = false,        // ← NEW: skip heavy listeners/long waits; DOM-only scrape
}) {
   const __capId = Math.random().toString(36).slice(2,7);
  const __capHost = (() => { try { return new URL(url).host } catch { return url } })();
  const __capLabel = `[cap ${__capHost} ${__capId}]`;
  console.time(__capLabel);
  console.log(__capLabel, 'start', { preferHttp1, navQuick, fastMode });
  let browser, context, page
  if (preferHttp1 || forceHeadful) {
    const b = await chromium.launch({
      headless: !forceHeadful,
      args: [
        ...(preferHttp1 ? ['--disable-http2'] : []),
        ...(forceHeadful ? ['--disable-blink-features=AutomationControlled'] : []),
      ],
    })
    const c = await b.newContext({
      userAgent: DESKTOP_UA,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9', 'Upgrade-Insecure-Requests': '1' },
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'Europe/Oslo',
    })
    await applyStealth(c)
    browser = b
    context = c
    page = await c.newPage()
  } else {
    browser = await chromium.launch({ headless })
    context = await browser.newContext({
      userAgent: DESKTOP_UA,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9', 'Upgrade-Insecure-Requests': '1' },
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'Europe/Oslo',
    })
    await applyStealth(context)
    page = await context.newPage()
  }

  // Speed-up: block heavy/irrelevant assets
  await context.route('**/*', (route) => {
    const req = route.request()
    const type = req.resourceType()
    const u = req.url()
    if (['image', 'media', 'font', 'stylesheet'].includes(type)) return route.abort()
    if (/\.(png|jpe?g|webp|gif|svg|ico|css|woff2?|ttf|eot)$/i.test(u)) return route.abort()
    if (/(doubleclick|googletag|google-analytics|facebook|hotjar|optimizely|tealium|adservice)\./i.test(u)) return route.abort()
    route.continue()
  })
  page.setDefaultNavigationTimeout(navQuick ? 9000 : timeoutMs)
  page.setDefaultTimeout(navQuick ? 9000 : timeoutMs)

  if (storage && typeof storage === 'object') {
    await context.addInitScript((kv) => {
      try { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v) } catch {}
    }, storage)
  }

  const requests = []
  const apiCandidates = []
  const arraySummaries = []
  const searchTotals = []
  const universeIdSet = new Set()
  let session = null

  // PASTE THIS RIGHT AFTER:
if (fastMode) {
  // Quick navigation profile: commit only, very short timeouts
  const quickNav = (preferHttp1 || navQuick)
    ? { timeouts: [1500, 2500, 4000], waits: ['commit'] }
    : { timeouts: [3000, 5000, 9000], waits: ['commit'] };

  await gotoResilient(page, url, quickNav).catch(() => {});

  // Best-effort consent (short timeouts)
  console.timeLog(__capLabel, 'nav ok');
  await page.getByRole('button', { name: /Godta alle|Accept all|Agree|OK/i })
    .click({ timeout: 800 }).catch(() => {});
  await page.locator(
    'button.message-button.primary, .sp_choice_type_11, [data-choice], .message-button, #onetrust-accept-btn-handler'
  ).first().click({ timeout: 800 }).catch(() => {});

  // Tiny settle
  await page.waitForTimeout(400).catch(() => {});

  // DOM content & links
  const domText = await page.content();
  const domUrls = Array.from(domText.matchAll(urlRegex)).map((m) => m[0]);
  const deepLinks = await collectDeepLinks(
    page,
    Array.isArray(navAllowPatterns) ? navAllowPatterns : []
  );
  let pageTitle = ''; try { pageTitle = await page.title() } catch {}

  // Booking DOM fallbacks (counts + IDs)
  await collectBookingDomFallbacks(page, searchTotals, universeIdSet);

  await browser.close();

  const byHost = {}; // minimal summary in fast mode

  return {
    summary: { seedUrl: url, apiCandidates: 0, totalRequests: 0 },
    apiCandidates,
    domUrls,
    byHost,
    arraySummaries,
    deepLinks,
    pageTitle,
    browserSearch: { searchTotals, universeIdsCount: universeIdSet.size },
  };
}

  try {
    session = await context.newCDPSession(page)
    await session.send('Network.enable')
    session.on('Network.requestWillBeSent', (e) => {
      if (!e?.request) return
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

  function attachPageListeners(pg, { url, sameOrigin }) {
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

    pg.on('response', async (res) => {
      try {
        const req = res.request()
        const reqUrl = req.url()
        let reqOrigin = '', seedOrigin = ''
        try { reqOrigin = new URL(reqUrl).origin; seedOrigin = new URL(url).origin } catch {}
        if (sameOrigin && seedOrigin && reqOrigin && reqOrigin !== seedOrigin) return

        const headers = await res.headers()
        const cls = classifyRequest(req, { headers })
        let entitySummary = null

        if (cls.isJson) {
          let txt = ''
          try { txt = await res.text() } catch {}
          if (txt) {
            try {
              const parsed = JSON.parse(txt)
              harvestBookingFromJson(parsed, req.url(), { searchTotals, universeIdSet })
              const arrs = summarizeArraysFromJson(parsed, { minArrayLength: 1, maxItemsToSample: 5 })
              for (const a of arrs) arraySummaries.push({ atUrl: req.url(), method: req.method(), ...a })
              entitySummary = summarizeJsonGenerically(req.url(), parsed)
            } catch {}
          }
        }

        if (cls.apiCandidate) {
          let opName = null, graphQLQuery = null
          if (cls.isGraphQL && req.method() === 'POST') {
            try {
              const body = req.postData() || ''
              if (/^[\[{]/.test(body.trim())) {
                const p = JSON.parse(body)
                const first = Array.isArray(p) ? p[0] : p
                opName = first?.operationName || null
                graphQLQuery = typeof first?.query === 'string' ? first.query.slice(0, 120) : null
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
            status: res.status(),
            opName,
            graphQLQuery,
            entitySummary,
          })
        }
      } catch {}
    })
  }

  attachPageListeners(page, { url, sameOrigin })

  const navOpts = navQuick ? { timeouts: [3000, 5000, 9000] } : { timeouts: [8000, 8000, timeoutMs] }
  let gotoOk = false
  try {
    await gotoResilient(page, url, navOpts)
    gotoOk = true
  } catch (e1) {
    const msg = String(e1?.message || e1)
    if (msg.includes('ERR_NAME_NOT_RESOLVED')) throw new Error(`DNS_RESOLUTION_FAILED: ${url}`)

    if (!gotoOk && msg.includes('ERR_HTTP2_PROTOCOL_ERROR')) {
      try {
        try { await context.close() } catch {}
        try { await browser.close() } catch {}
        const b = await chromium.launch({ headless: true, args: ['--disable-http2'] })
        const c = await b.newContext({
          userAgent: DESKTOP_UA,
          ignoreHTTPSErrors: true,
          extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9', 'Upgrade-Insecure-Requests': '1' },
          viewport: { width: 1280, height: 800 },
          locale: 'en-US',
          timezoneId: 'Europe/Oslo',
        })
        await applyStealth(c)
        browser = b; context = c; page = await c.newPage()
        attachPageListeners(page, { url, sameOrigin })
        try {
          session = await context.newCDPSession(page)
          await session.send('Network.enable')
        } catch {}
        await gotoResilient(page, url, navOpts)
        gotoOk = true
      } catch {}
    }

    if (!gotoOk) {
      try {
        try { await context.close() } catch {}
        try { await browser.close() } catch {}
        const b = await chromium.launch({
          headless: false,
          args: ['--disable-http2', '--disable-blink-features=AutomationControlled'],
        })
        const c = await b.newContext({
          userAgent: DESKTOP_UA,
          ignoreHTTPSErrors: true,
          extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9', 'Upgrade-Insecure-Requests': '1' },
          viewport: { width: 1280, height: 800 },
          locale: 'en-US',
          timezoneId: 'Europe/Oslo',
        })
        await applyStealth(c)
        browser = b; context = c; page = await c.newPage()
        attachPageListeners(page, { url, sameOrigin })
        await gotoResilient(page, url, navOpts)
        gotoOk = true
      } catch {
        throw e1
      }
    }
  }

  // Consent
  await page.getByRole('button', { name: /Godta alle|Accept all|Agree|OK/i }).click({ timeout: 1500 }).catch(() => {})
  await page.locator('button.message-button.primary, .sp_choice_type_11, [data-choice], .message-button, #onetrust-accept-btn-handler')
    .first().click({ timeout: 1500 }).catch(() => {})

  // Booking SRP ready
  await waitForBookingSrpReady(page, 10000).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {})

  if (autoScroll) {
    try {
      await page.evaluate(async () => {
        await new Promise((res) => {
          let y = 0, id = setInterval(() => {
            y += 300; window.scrollTo({ top: y, behavior: 'instant' }); if (y >= 2800) { clearInterval(id); res(); }
          }, 200)
        })
      })
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
    } catch {}
  }

  const domText = await page.content()
  const domUrls = Array.from(domText.matchAll(urlRegex)).map((m) => m[0])
  const deepLinks = await collectDeepLinks(page, Array.isArray(navAllowPatterns) ? navAllowPatterns : [])
  let pageTitle = ''; try { pageTitle = await page.title() } catch {}
console.timeLog(__capLabel, 'dom collected');
  await collectBookingDomFallbacks(page, searchTotals, universeIdSet)

  await browser.close()

  const byHost = {}
  for (const r of apiCandidates) {
    try {
      const h = new URL(r.url).host
      byHost[h] = (byHost[h] || 0) + 1
    } catch {}
  }
console.timeEnd(__capLabel);
  return {
    summary: { seedUrl: url, apiCandidates: apiCandidates.length, totalRequests: requests.length },
    apiCandidates,
    domUrls,
    byHost,
    arraySummaries,
    deepLinks,
    pageTitle,
    browserSearch: {
      searchTotals,
      universeIdsCount: universeIdSet.size,
    },
  }
}
