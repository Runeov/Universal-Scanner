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
      navAllowPatterns
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
      exportDir
    })

    // Base HTTP scan (no JS execution)
    const base = await scanSite({
      seedUrl: url,
      maxDepth: Number(maxDepth),
      sameOrigin: Boolean(sameOrigin),
      maxPages: Number(maxPages),
      timeoutMs: Number(timeoutMs)
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

    // Headless browser capture (XHR/Fetch/GraphQL)
    const browserPart = await browseAndCapture({
      url,
      headless: true,
      timeoutMs: Math.max(Number(timeoutMs), 25000),
      sameOrigin: Boolean(sameOrigin),
      autoScroll: true,
      navAllowPatterns
    })

    // Browser-only mode
    if (mode === 'browser') {
      let output = { browser: browserPart }
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
        browserTotalRequests: browserPart.summary.totalRequests
      },
      byHost: {
        ...base.byHost,
        ...browserPart.byHost
      }
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

const PORT = process.env.PORT || 5174
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`)
})
