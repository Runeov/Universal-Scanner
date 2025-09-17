// server/scan.mjs
import * as cheerio from 'cheerio'
import PQueue from 'p-queue'
import { absolute, sameOrigin, urlRegex } from './util.mjs'
import { detectSelfDescribing, collectArrayStats, jsonStringUrls } from './detectors.mjs'
import { createProvenance } from './provenance.mjs'

// Robust import that works whether fast-xml-parser is CJS or ESM
import * as fxp from 'fast-xml-parser'
const XMLParser = fxp.XMLParser ?? fxp.default?.XMLParser ?? fxp.default

const DEFAULT_HEADERS = {
  'User-Agent': 'universal-scanner/0.1 (+https://localhost)',
  'Accept': 'text/html,application/json,application/ld+json,application/xml;q=0.9,*/*;q=0.8'
}

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs).unref?.()
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, redirect: 'follow', signal: ctrl.signal })
    const ctype = res.headers.get('content-type') || ''
    const text = await res.text()
    return { status: res.status, ok: res.ok, contentType: ctype, text }
  } finally {
    clearTimeout(t)
  }
}

function extractFromHtml(BASE_URL, html, prov, out) {
  const $ = cheerio.load(html)

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    const url = absolute(BASE_URL, href)
    if (url) out.links.add(url)
  })

  $('img[src]').each((_, el) => {
    const src = $(el).attr('src')
    const url = absolute(BASE_URL, src)
    if (url) {
      prov.add(url, `html @ ${BASE_URL}`)
      out.images.add(url)
    }
  })
  $('source[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset') || ''
    srcset.split(',').forEach(item => {
      const [u] = item.trim().split(' ')
      const url = absolute(BASE_URL, u)
      if (url) {
        prov.add(url, `html/srcset @ ${BASE_URL}`)
        out.images.add(url)
      }
    })
  })

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).text())
      const nodes = Array.isArray(json) ? json : [json]
      for (const n of nodes) {
        const info = detectSelfDescribing(n)
        if (info) out.selfdesc.push({ url: BASE_URL, info })
        const imgs = Array.isArray(n.image) ? n.image : (n.image ? [n.image] : [])
        imgs.filter(x => typeof x === 'string').forEach(u => {
      const abs = absolute(BASE_URL, u)
          if (abs) {
            prov.add(abs, `jsonld @ ${BASE_URL}`)
            out.images.add(abs)
          }
        })
      }
    } catch {}
  })

  const raw = $.root().text()
  for (const m of raw.matchAll(urlRegex)) {
    out.endpoints.add(m[0])
  }
}

function extractFromJson(BASE_URL, text, prov, out) {
  let obj
  try { obj = JSON.parse(text) } catch { return }

  const info = detectSelfDescribing(obj)
  if (info) out.selfdesc.push({ url: BASE_URL, info })

  const arrays = collectArrayStats(obj)
  arrays.forEach(a => out.arrays.push({ ...a, sourceUrl: BASE_URL }))

  for (const { url, path } of jsonStringUrls(obj)) {
    out.endpoints.add(url)
    if (/(?:\.jpg|\.jpeg|\.png|\.webp|\.gif)(?:\?|$)/i.test(url)) {
      prov.add(url, `json@${BASE_URL} ${path}`)
      out.images.add(url)
    }
  }
}

function extractFromXml(BASE_URL, text, prov, out) {
  let obj
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })
    obj = parser.parse(text)
  } catch { return }

  const stack = [obj]
  while (stack.length) {
    const v = stack.pop()
    if (!v || typeof v !== 'object') continue
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'string') {
        if (/^https?:\/\//i.test(val)) {
          out.endpoints.add(val)
          if (/(?:\.jpg|\.jpeg|\.png|\.webp|\.gif)(?:\?|$)/i.test(val)) {
            prov.add(val, `xml@${BASE_URL} ${k}`)
            out.images.add(val)
          }
        }
      } else if (val && typeof val === 'object') {
        stack.push(val)
      }
    }
  }
}

export async function scanSite({ seedUrl, maxDepth = 1, sameOrigin: so = true, maxPages = 20, timeoutMs = 15000 }) {
  const q = [{ url: seedUrl, depth: 0 }]
  const visited = new Set()
  const endpoints = new Set()
  const images = new Set()
  const links = new Set()
  const selfdesc = []
  const arrays = []
  const logs = []
  const prov = createProvenance()

  const queue = new PQueue({ concurrency: 4 })

  async function handle({ url, depth }) {
    if (visited.has(url) || visited.size >= maxPages) return
    visited.add(url)

    logs.push({ level: 'info', msg: `Fetching ${url}` })
    let res
    try {
      res = await fetchText(url, timeoutMs)
    } catch (e) {
      logs.push({ level: 'error', msg: `Fetch failed ${url}: ${e}` })
      return
    }
    const { contentType = '', text = '' } = res

    for (const m of text.matchAll(urlRegex)) {
      endpoints.add(m[0])
    }

    if (/json/i.test(contentType)) {
      extractFromJson(url, text, prov, { endpoints, images, links, selfdesc, arrays })
    } else if (/xml|rss|atom/i.test(contentType) || /^<\?xml|<feed|<entry|<rss/i.test(text)) {
      extractFromXml(url, text, prov, { endpoints, images, links, selfdesc, arrays })
    } else if (/html/i.test(contentType) || /<html/i.test(text)) {
      extractFromHtml(url, text, prov, { endpoints, images, links, selfdesc, arrays })
    }

    if (depth < maxDepth) {
      for (const next of links) {
        if (!visited.has(next) && (!so || sameOrigin(seedUrl, next))) {
          q.push({ url: next, depth: depth + 1 })
        }
      }
    }
  }

  while (q.length) {
    const batch = q.splice(0, 8)
    await Promise.all(batch.map(job => queue.add(() => handle(job))))
  }

  const endpointList = Array.from(endpoints).map(u => {
    try {
      const { hostname } = new URL(u)
      return { url: u, host: hostname }
    } catch {
      return { url: u, host: null }
    }
  })

  const byHost = endpointList.reduce((acc, e) => {
    const h = e.host || 'unknown'
    acc[h] = (acc[h] || 0) + 1
    return acc
  }, {})

  return {
    summary: {
      seedUrl,
      pagesScanned: visited.size,
      imagesFound: images.size,
      endpointsFound: endpoints.size
    },
    endpoints: endpointList,
    images: Array.from(images),
    provenance: prov.toArray(),
    selfDescribing: selfdesc,
    arrays,
    byHost,
    logs
  }
}
