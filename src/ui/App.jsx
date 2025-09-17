// src/ui/App.jsx
import React, { useState } from 'react'
import Results from './Results.jsx'
import Navbar from '../components/Navbar.jsx'
import OccupancyPanel from "../components/OccupancyPanel.jsx";




export default function App() {

  // --- Nav state ---
  const [activeTab, setActiveTab] = useState('home')

  // --- Scanner state ---
  const [url, setUrl] = useState('https://www.booking.com/')
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState(null)
  const [opts, setOpts] = useState({
    maxDepth: 0,
    sameOrigin: true,
    maxPages: 6,
    useBrowser: true,            // toggles 'both' vs 'http' mode
    exportLogs: true,
    exportJson: true,
    exportNdjson: true,
    exportCsv: false,
    collectDeepLinks: true,
    navAllowPatterns: '/search,/browse,/bap/,/recommerce/,/realestate/,/job/,/search.html',
    category: 'accommodation', // NEW default
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
            ...(opts.exportCsv ? ['csv'] : []),
          ],
          navAllowPatterns: opts.collectDeepLinks
            ? (opts.navAllowPatterns || '').split(',').map(s => s.trim()).filter(Boolean)
            : [],
            category: opts.category, // NEW
        }),
      })
      const json = await res.json()
      setData(json)
    } catch (e) {
      setData({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }

  // --- December availability sample (Booking SRP heuristic) ---
  const [place, setPlace] = useState('Tromsø')
  const [nights, setNights] = useState(1)
  const [sampling, setSampling] = useState(false)
  const [sample, setSample] = useState(null)

  function decemberEvery3Days(year = new Date().getFullYear()) {
    const ds = []
    for (let d = 1; d <= 28; d += 3) {
      const dt = new Date(Date.UTC(year, 11, d)) // December = 11
      ds.push(dt.toISOString().slice(0, 10))
    }
    return ds
  }

 async function runDecemberSample() {
  try {
    setSampling(true);
    setSample(null);
    const dates = decemberEvery3Days();

    const res = await fetch('/api/availability-sample', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ place, nights, dates })
    });

    const ctype = res.headers.get('content-type') || '';
    const text = await res.text(); // read once, then decide

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!/application\/json/i.test(ctype)) {
      throw new Error(
        `Expected JSON but got "${ctype}". First 200 chars:\n${text.slice(0, 200)}`
      );
    }

    const json = JSON.parse(text);
    setSample(json);
  } catch (e) {
    console.error('availability-sample failed:', e);
    alert(`Availability sample failed: ${e.message || e}`);
  } finally {
    setSampling(false);
  }
}


  return (
  <>
    {/* Navbar + tabs */}
    <Navbar
      items={[
        { key: 'home', label: 'Home' },
        { key: 'scan', label: 'Scan' },
        { key: 'queue', label: 'Queue' },
        { key: 'occupancy', label: 'Occupancy' },
      ]}
      activeKey={activeTab}
      onChange={setActiveTab}
    />

    {/* Occupancy tab content */}
    {activeTab === 'occupancy' && (
      <div style={{ padding: 16 }}>
        <OccupancyPanel initialScan={data} category={opts.category} />
      </div>
    )}

    {/* Original UI (shown when NOT on the Occupancy tab) */}
    {activeTab !== 'occupancy' && (
      <div className="container">
        {/* Scanner Controls */}
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

<div>
  <label>Category</label><br />
  <select
    value={opts.category}
    onChange={(e) => setOpts((o) => ({ ...o, category: e.target.value }))}
  >
    <option value="accommodation">Accommodation</option>
    {/* add more later:
      <option value="auctions">Auctions</option>
      <option value="social">Social</option>
    */}
  </select>
</div>

          <div className="row">
            <div>
              <label>Max depth</label><br />
              <input
                type="number"
                min="0"
                max="3"
                value={opts.maxDepth}
                onChange={(e) => setOpts((o) => ({ ...o, maxDepth: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label>Max pages</label><br />
              <input
                type="number"
                min="1"
                max="100"
                value={opts.maxPages}
                onChange={(e) => setOpts((o) => ({ ...o, maxPages: Number(e.target.value) }))}
              />
            </div>
            <div className="flex" style={{ marginTop: '1.35rem' }}>
              <input
                id="so"
                type="checkbox"
                checked={opts.sameOrigin}
                onChange={(e) => setOpts((o) => ({ ...o, sameOrigin: e.target.checked }))}
              />
              <label htmlFor="so">Same-origin only</label>
            </div>
            <div className="flex" style={{ marginTop: '1.35rem' }}>
              <input
                id="ub"
                type="checkbox"
                checked={opts.useBrowser}
                onChange={(e) => setOpts((o) => ({ ...o, useBrowser: e.target.checked }))}
              />
              <label htmlFor="ub">Use headless browser (capture XHR/Fetch)</label>
            </div>
          </div>

          <div className="flex" style={{ marginTop: '.25rem' }}>
            <input
              id="ex"
              type="checkbox"
              checked={opts.exportLogs}
              onChange={(e) => setOpts((o) => ({ ...o, exportLogs: e.target.checked }))}
            />
            <label htmlFor="ex">Export to /logs</label>
          </div>
          <div className="row" aria-label="Export formats">
            <div className="flex">
              <input
                id="exj"
                type="checkbox"
                checked={opts.exportJson}
                onChange={(e) => setOpts((o) => ({ ...o, exportJson: e.target.checked }))}
              />
              <label htmlFor="exj">JSON</label>
            </div>
            <div className="flex">
              <input
                id="exn"
                type="checkbox"
                checked={opts.exportNdjson}
                onChange={(e) => setOpts((o) => ({ ...o, exportNdjson: e.target.checked }))}
              />
              <label htmlFor="exn">NDJSON</label>
            </div>
            <div className="flex">
              <input
                id="exc"
                type="checkbox"
                checked={opts.exportCsv}
                onChange={(e) => setOpts((o) => ({ ...o, exportCsv: e.target.checked }))}
              />
              <label htmlFor="exc">CSV (byHost)</label>
            </div>
          </div>

          <div className="flex">
            <button onClick={run} disabled={busy}>
              {busy ? 'Scanning…' : 'Scan'}
            </button>
            {data && (
     <button
       style={{ marginLeft: '0.5rem' }}
       onClick={() => setActiveTab('occupancy')}
       title="Open Occupancy tab with current scan JSON"
     >
       Analyze occupancy →
     </button>
   )}
            {data?.summary && (
              <span className="small">Scanned {data.summary.pagesScanned} page(s)</span>
            )}
            {data?.summary?.browserApiCandidates != null && (
              <span className="small"> · Browser API calls: {data.summary.browserApiCandidates}</span>
            )}
          </div>
        </div>

        <div style={{ height: '.75rem' }} />

        {/* December Availability Sample Card */}
        <div className="card">
          <h3>December Availability Sample</h3>
          <div className="row" style={{ marginBottom: '.5rem' }}>
            <div>
              <label>Place</label><br />
              <input value={place} onChange={(e) => setPlace(e.target.value)} />
            </div>
            <div>
              <label>Nights</label><br />
              <input
                type="number"
                min="1"
                max="14"
                value={nights}
                onChange={(e) => setNights(Number(e.target.value) || 1)}
              />
            </div>
            <div className="flex" style={{ alignItems: 'end' }}>
              <button onClick={runDecemberSample} disabled={sampling}>
                {sampling ? 'Sampling…' : 'Run December sample'}
              </button>
            </div>
          </div>

          {!sample && (
            <p className="muted">
              Run a sample to estimate December occupancy for <strong>{place}</strong>.
            </p>
          )}

          {sample && (
            <>
              <p className="small">
                Universe (est.): <strong>{sample.universeSize}</strong> venues · Avg occupancy{' '}
                <strong>
                  {sample.avgOccupancyPct != null
                    ? Math.round(sample.avgOccupancyPct * 1000) / 10
                    : '—'}
                  %
                </strong>
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Available</th>
                    <th>Occupancy%</th>
                  </tr>
                </thead>
                <tbody>
                  {sample.samples.map((s, i) => (
                    <tr key={i}>
                      <td>{s.date}</td>
                      <td>{s.available ?? '—'}</td>
                      <td>
                        {s.occupancyPct != null
                          ? Math.round(s.occupancyPct * 1000) / 10 + '%'
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div style={{ height: '.75rem' }} />

        {/* Results */}
        <div className="card">
          {!data && <p className="muted">Results will show here.</p>}
          {data?.error && <pre>{data.error}</pre>}
          {data?.summary && <Results data={data} onMerge={(merged) => setData(merged)} />}
        </div>
      </div>
    )}
  </>
);
}