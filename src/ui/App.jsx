// src/ui/App.jsx
import React, { useState } from 'react'
import Results from './Results.jsx'

export default function App() {
  const [url, setUrl] = useState('https://www.hotels.com/')
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState(null)
  const [opts, setOpts] = useState({
    maxDepth: 0,
    sameOrigin: true,
    maxPages: 6,
    useBrowser: true, // toggles 'both' vs 'http' mode
    exportLogs: true,
    exportJson: true,
    exportNdjson: true,
    exportCsv: false,
    collectDeepLinks: true,
    navAllowPatterns: "/search,/browse,/bap/,/recommerce/,/realestate/,/job/"

    
  })

  async function run() {
    setBusy(true)
    setData(null)
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url,
          maxDepth: opts.maxDepth,
          sameOrigin: opts.sameOrigin,
          maxPages: opts.maxPages,
          mode: opts.useBrowser ? 'both' : 'http',
          exportLogs: opts.exportLogs,
          exportFormats: [
            ...(opts.exportJson ? ['json'] : []),
            ...(opts.exportNdjson ? ['ndjson'] : []),
            ...(opts.exportCsv ? ['csv'] : [])
          ],
          navAllowPatterns: opts.collectDeepLinks
            ? (opts.navAllowPatterns || '').split(',').map(s => s.trim()).filter(Boolean)
            : []
        })
      })
      const json = await res.json()
      setData(json)
    } catch (e) {
      setData({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container">
      <div className="card grid cols-2">
        <div>
          <label>Seed URL</label>
          <input
            style={{ width: '100%' }}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>

        <div className="row">
          <div>
            <label>Max depth</label>
            <br />
            <input
              type="number"
              min="0"
              max="3"
              value={opts.maxDepth}
              onChange={(e) =>
                setOpts((o) => ({ ...o, maxDepth: Number(e.target.value) }))
              }
            />
          </div>

          <div>
            <label>Max pages</label>
            <br />
            <input
              type="number"
              min="1"
              max="100"
              value={opts.maxPages}
              onChange={(e) =>
                setOpts((o) => ({ ...o, maxPages: Number(e.target.value) }))
              }
            />
          </div>

          <div className="flex" style={{ marginTop: '1.35rem' }}>
            <input
              id="so"
              type="checkbox"
              checked={opts.sameOrigin}
              onChange={(e) =>
                setOpts((o) => ({ ...o, sameOrigin: e.target.checked }))
              }
            />
            <label htmlFor="so">Same-origin only</label>
          </div>

          <div className="flex" style={{ marginTop: '1.35rem' }}>
            <input
              id="ub"
              type="checkbox"
              checked={opts.useBrowser}
              onChange={(e) =>
                setOpts((o) => ({ ...o, useBrowser: e.target.checked }))
              }
            />
            <label htmlFor="ub">Use headless browser (capture XHR/Fetch)</label>
          </div>
        </div>

        <div className="flex" style={{ marginTop: '.25rem' }}>
          <input
            id="ex"
            type="checkbox"
            checked={opts.exportLogs}
            onChange={(e) =>
              setOpts((o) => ({ ...o, exportLogs: e.target.checked }))
            }
          />
          <label htmlFor="ex">Export to /logs</label>
        </div>
        <div className="row" aria-label="Export formats">
          <div className="flex" style={{marginTop:'1.35rem'}}>
          <input id="dl" type="checkbox" checked={opts.collectDeepLinks}
                 onChange={e=>setOpts(o=>({...o,collectDeepLinks:e.target.checked}))}/>
          <label htmlFor="dl">Collect deep links (grid/browse/category)</label>
        </div>
        <div style={{width:'100%'}}>
          <label>Allow patterns (CSV)</label>
          <input style={{width:'100%'}} value={opts.navAllowPatterns}
                 onChange={e=>setOpts(o=>({...o,navAllowPatterns:e.target.value}))}/>
        </div>
          <div className="flex">
            <input
              id="exj"
              type="checkbox"
              checked={opts.exportJson}
              onChange={(e) =>
                setOpts((o) => ({ ...o, exportJson: e.target.checked }))
              }
            />
            <label htmlFor="exj">JSON</label>
          </div>
          <div className="flex">
            <input
              id="exn"
              type="checkbox"
              checked={opts.exportNdjson}
              onChange={(e) =>
                setOpts((o) => ({ ...o, exportNdjson: e.target.checked }))
              }
            />
            <label htmlFor="exn">NDJSON</label>
          </div>
          <div className="flex">
            <input
              id="exc"
              type="checkbox"
              checked={opts.exportCsv}
              onChange={(e) =>
                setOpts((o) => ({ ...o, exportCsv: e.target.checked }))
              }
            />
            <label htmlFor="exc">CSV (byHost)</label>
          </div>
        </div>

        <div className="flex">
          <button onClick={run} disabled={busy}>
            {busy ? 'Scanning…' : 'Scan'}
          </button>
          {data?.summary && (
            <span className="small">Scanned {data.summary.pagesScanned} page(s)</span>
          )}
          {data?.summary?.browserApiCandidates != null && (
            <span className="small">
              {' '}
              · Browser API calls: {data.summary.browserApiCandidates}
            </span>
          )}
        </div>
      </div>

      <div style={{ height: '.75rem' }} />

      <div className="card">
        {!data && <p className="muted">Results will show here.</p>}
        {data?.error && <pre>{data.error}</pre>}
        {data?.summary && <Results data={data} onMerge={(merged)=>setData(merged)} />}
      </div>
    </div>
  )
}
