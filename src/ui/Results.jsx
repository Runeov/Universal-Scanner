// src/ui/Results.jsx
import React, { useMemo } from 'react'

function clip(text, max = 20) {
  if (!text || text.length <= max) return text
  const head = Math.ceil((max - 1) * 0.6)
  const tail = (max - 1) - head
  return text.slice(0, head) + '…' + text.slice(-tail)
}

function pct(num, den) {
  if (!den) return '—'
  const v = (num / den) * 100
  if (!isFinite(v)) return '—'
  return `${Math.round(v)}%`
}

function hostOf(u) {
  try { return new URL(u).host } catch { return '' }
}

/**
 * Derive a stable entity from URL paths like:
 *   /holidaze/venues, /holidaze/venues/search, /api/v2/venues?page=2, ...
 */
function entityFromUrl(u) {
  try {
    const segs = new URL(u).pathname.toLowerCase().split('/').filter(Boolean)
    const idx = segs.indexOf('holidaze')
    if (idx >= 0 && segs[idx + 1]) return segs[idx + 1]
    const plurals = segs.filter(s => /s$/.test(s))
    if (plurals.length) return plurals[0]
    return segs[segs.length - 1] || 'json'
  } catch {
    return 'json'
  }
}

/** Build a stable columns signature (sorted) for an array summary */
function columnsSig(a) {
  const cols = Array.isArray(a?.columns) ? a.columns.slice() : []
  if (!cols.length && Array.isArray(a?.sample) && a.sample.length) {
    const first = a.sample.find(x => x && typeof x === 'object' && !Array.isArray(x))
    if (first) for (const k of Object.keys(first)) cols.push(k)
  }
  cols.sort()
  return cols.join('|')
}

/**
 * De-duplicate runtime arrays:
 * - Group by (entity + columnsSig)
 * - Keep the "best" by: length > scanned > #columns
 */
function dedupeRuntimeArrays(arr = []) {
  const groups = new Map()
  for (const a of arr) {
    const entity = entityFromUrl(a.atUrl || '')
    const sig = columnsSig(a)
    const key = `${entity}::${sig}`
    const current = groups.get(key)
    if (!current) { groups.set(key, a); continue }
    const better =
      (a.length || 0) > (current.length || 0) ||
      ((a.length || 0) === (current.length || 0) && (a.scanned || 0) > (current.scanned || 0)) ||
      ((a.length || 0) === (current.length || 0) &&
        (a.scanned || 0) === (current.scanned || 0) &&
        (a.columns?.length || 0) > (current.columns?.length || 0))
    if (better) groups.set(key, a)
  }
  return Array.from(groups.values())
}

// Fallback: synthesize field stats from sample if server didn't send fieldStats yet
function synthesizeFieldStatsFromSample(summary) {
  const fs = {}
  const total = summary.sample?.length || 0
  if (!total) return { fieldStats: {}, scanned: 0 }
  for (const it of summary.sample) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue
    for (const [k, v] of Object.entries(it)) {
      const rec =
        fs[k] ||
        (fs[k] = {
          present: 0,
          nullish: 0,
          types: {},
          examples: [],
          hasDateLike: false,
          numeric: null,
          unique: null,
        })
      if (v === null || v === undefined) {
        rec.nullish++
      } else {
        rec.present++
        const t = typeof v
        rec.types[t] = (rec.types[t] || 0) + 1
        if (t === 'number') {
          if (!rec.numeric) rec.numeric = { min: v, max: v }
          if (v < rec.numeric.min) rec.numeric.min = v
          if (v > rec.numeric.max) rec.numeric.max = v
        }
        if (t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) rec.hasDateLike = true
        if (rec.examples.length < 3) rec.examples.push(v)
      }
    }
  }
  return { fieldStats: fs, scanned: total }
}

export default function Results({ data, onMerge }) {
  const {
    summary = {},
    endpoints = [],
    images = [],
    selfDescribing = [],
    arrays = [],
    provenance = [],
    byHost = {},
    logs = [],
    browser,
    exported,
    exportError,
  } = data || {}

  // Raw and de-duplicated runtime arrays
  const rawRuntime = browser?.arraySummaries || []
  const runtime = useMemo(() => dedupeRuntimeArrays(rawRuntime), [rawRuntime])
  const runtimeCountRaw = rawRuntime.length
  const runtimeCount = runtime.length

  // ---------- Aggregate datapoints across de-duplicated runtime arrays ----------
  const datapoints = useMemo(() => {
    const acc = new Map()
    for (const a of runtime) {
      const entity = entityFromUrl(a.atUrl || '')
      const scanned = a.scanned || 0
      const { fieldStats, scanned: synthScanned } = a.fieldStats
        ? { fieldStats: a.fieldStats, scanned: scanned }
        : synthesizeFieldStatsFromSample(a)
      const total = scanned || synthScanned || 0

      for (const [field, stats] of Object.entries(fieldStats || {})) {
        const key = `${entity}.${field}`
        let rec = acc.get(key)
        if (!rec) {
          rec = {
            key,
            entity,
            field,
            present: 0,
            total: 0,
            types: {},
            min: undefined,
            max: undefined,
            hasDateLike: false,
            examples: [],
            sources: new Set(),
          }
          acc.set(key, rec)
        }
        rec.present += stats.present || 0
        rec.total += total
        for (const [t, c] of Object.entries(stats.types || {})) {
          rec.types[t] = (rec.types[t] || 0) + c
        }
        if (stats.numeric && typeof stats.numeric.min === 'number') {
          rec.min = rec.min === undefined ? stats.numeric.min : Math.min(rec.min, stats.numeric.min)
        }
        if (stats.numeric && typeof stats.numeric.max === 'number') {
          rec.max = rec.max === undefined ? stats.numeric.max : Math.max(rec.max, stats.numeric.max)
        }
        if (stats.hasDateLike) rec.hasDateLike = true
        for (const ex of stats.examples || []) {
          if (rec.examples.length < 3) rec.examples.push(ex)
        }
        if (a.atUrl) rec.sources.add(a.atUrl)
      }
    }
    const rows = Array.from(acc.values())
    rows.sort((a, b) => {
      const prio = (r) =>
        (r.field.includes('name') ? 3 : 0) +
        (r.field.includes('price') ? 2 : 0) +
        (r.field === 'id' ? 2 : 0) +
        r.present / Math.max(1, r.total)
      return prio(b) - prio(a) || b.present - a.present || a.key.localeCompare(b.key)
    })
    return rows
  }, [runtime])

  return (
  <div className="grid cols-2">



    
   {/* Summary — COLLAPSIBLE */}
<section>
  <details open>
    <summary>
      <strong>Summary</strong>
    </summary>
    
    <div style={{ paddingTop: '.5rem' }}>
      <table>
        <tbody>
          <tr>
            <th>Seed</th>
            <td><code>{summary.seedUrl || '-'}</code></td>
          </tr>
          <tr>
            <th>Pages</th>
            <td>{summary.pagesScanned ?? 0}</td>
          </tr>
          <tr>
            <th>Endpoints</th>
            <td>{summary.endpointsFound ?? 0}</td>
          </tr>
          <tr>
            <th>Images</th>
            <td>{summary.imagesFound ?? 0}</td>
          </tr>
          {summary.browserApiCandidates != null && (
            <tr>
              <th>Browser API calls</th>
              <td>{summary.browserApiCandidates} / {summary.browserTotalRequests} total</td>
            </tr>
          )}
          {browser?.deepLinks && (
            <tr>
              <th>Deep links (found)</th>
              <td>{browser.deepLinks.length}</td>
            </tr>
          )}
        </tbody>
      </table>

      {exported && (
        <>
          <h4>Saved to disk</h4>
          <table>
            <thead><tr><th>Directory</th><th>Files</th></tr></thead>
            <tbody>
              <tr>
                <td className="clip"><code>{exported.dir}</code></td>
                <td>
                  {exported.files.map((p, i) => (
                    <div key={i} className="small clip" title={p}><code>{p}</code></div>
                  ))}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      {exportError && <p className="muted">Export error: {String(exportError)}</p>}

{/* Deep links — COLLAPSIBLE (select & queue, with Parent ▶ URL; parent clickable; child EXPANDABLE + COLLAPSED by default) */}
<details> {/* collapsed by default */}
  <summary>
    <strong>Deep links</strong>{' '}
    <span className="muted">({browser?.deepLinks?.length || 0})</span>
  </summary>
  <div style={{ paddingTop: '.5rem' }}>
    {!browser?.deepLinks?.length && (
      <p className="muted">None collected.</p>
    )}
    {!!browser?.deepLinks?.length && (
      <>
        <div className="row" style={{ marginBottom: '.5rem' }}>
          <button
            onClick={async () => {
              const rows = Array.from(document.querySelectorAll('[data-dl-row]'))
              const picked = rows
                .map(row => {
                  const cb = row.querySelector('input[type="checkbox"]')
                  if (!cb || !cb.checked) return null
                  const href = row.getAttribute('data-href')
                  const from = row.getAttribute('data-parent') || (summary.seedUrl || '')
                  return href ? { href, from } : null
                })
                .filter(Boolean)

              if (!picked.length) return

              const body = {
                base: data,
                links: picked,
                sameOrigin: true,
                maxDepth: 0,
                maxPages: 6,
                timeoutMs: 15000,
                mode: 'both',
                navAllowPatterns: []
              }
              try {
                const res = await fetch('/api/queue-scan', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(body)
                })
                const merged = await res.json()
                if (typeof onMerge === 'function') onMerge(merged)
              } catch (e) {
                console.error('queue-scan failed', e)
              }
            }}
          >
            Queue selected links &amp; merge
          </button>
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: '2rem' }}></th>
              <th>Parent ▶ URL</th>
              <th>Text</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(new Map(
              (browser.deepLinks || []).map(l => [l.href + '|' + (l.parent || ''), l])
            ).values())
              .slice(0, 80)
              .map((l, i) => (
                <tr key={i} data-dl-row data-href={l.href} data-parent={l.parent || ''}>
                  <td><input type="checkbox" /></td>
                  <td className="clip">
                    {/* Parent (clickable) ▶ Child (clickable) */}
                    {l.parent ? (
                      <a href={l.parent} target="_blank" rel="noreferrer">
                        <code title={(l.parentTitle ? l.parentTitle + ' — ' : '') + l.parent}>
                          {clip(l.parentTitle || l.parent, 42)}
                        </code>
                      </a>
                    ) : (
                      <code>—</code>
                    )}
                    {' '}▶{' '}
                    <a href={l.href} target="_blank" rel="noreferrer">
                      <code title={l.href}>{clip(l.href, 42)}</code>
                    </a>
                  </td>
                  <td className="clip">
                    {/* Child details: EXPANDABLE & COLLAPSED by default */}
                    <details>
                      <summary>
                        <code title={l.text || ''}>{clip(l.text || '—', 42)}</code>
                      </summary>
                      <div className="small" style={{ paddingTop: '.35rem' }}>
                        <div>
                          <strong>Parent:</strong>{' '}
                          {l.parent ? (
                            <a href={l.parent} target="_blank" rel="noreferrer">
                              <code title={l.parent}>
                                {clip(l.parentTitle || l.parent, 72)}
                              </code>
                            </a>
                          ) : (
                            <code>—</code>
                          )}
                        </div>
                        <div>
                          <strong>URL:</strong>{' '}
                          <a href={l.href} target="_blank" rel="noreferrer">
                            <code title={l.href}>{clip(l.href, 72)}</code>
                          </a>
                        </div>
                        <div>
                          <strong>Text:</strong>{' '}
                          <code title={l.text || ''}>{clip(l.text || '—', 72)}</code>
                        </div>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </>
    )}
  </div>
</details>





      {/* By host — COLLAPSIBLE with sorting & empty-state */}
      <details open={Object.keys(byHost || {}).length > 0}>
        <summary>
          <strong>By host</strong>{' '}
          <span className="muted">({Object.keys(byHost || {}).length})</span>
        </summary>
        <div style={{ paddingTop: '.5rem' }}>
          <table>
            <thead><tr><th>Host</th><th>Count</th></tr></thead>
            <tbody>
              {Object.entries(byHost || {})
                .sort((a, b) => b[1] - a[1])
                .map(([h, c]) => (
                  <tr key={h}>
                    <td className="clip">{h}</td>
                    <td>{c}</td>
                  </tr>
                ))}
              {(!byHost || Object.keys(byHost).length === 0) && (
                <tr>
                  <td colSpan={2} className="muted">None</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  </details>
</section>

  


      {/* Self-describing — COLLAPSIBLE */}
      <section>
        <details open={selfDescribing.length > 0}>
          <summary>
            <strong>Self-describing</strong>{' '}
            <span className="muted">({selfDescribing.length})</span>
          </summary>
          <div style={{ paddingTop: '.5rem' }}>
            <table>
              <thead><tr><th>Page</th><th>Kind</th><th>Meta</th></tr></thead>
              <tbody>
                {selfDescribing.map((s, i) => (
                  <tr key={i}>
                    <td className="clip"><code>{clip(s.url)}</code></td>
                    <td><span className="badge">{s.info?.kind || '-'}</span></td>
                    <td><code className="clip">{clip(String(s.info?.meta ?? ''))}</code></td>
                  </tr>
                ))}
                {selfDescribing.length === 0 && (
                  <tr><td colSpan={3} className="muted">None detected</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* Endpoints — COLLAPSIBLE */}
      <section>
        <details open={endpoints.length > 0}>
          <summary>
            <strong>Endpoints</strong>{' '}
            <span className="muted">({endpoints.length})</span>
          </summary>
          <div style={{ paddingTop: '.5rem' }}>
            <table>
              <thead><tr><th>URL</th><th>Host</th></tr></thead>
              <tbody>
                {endpoints.map((e,i) => (
                  <tr key={i}>
                    <td><code className="clip" title={e.url}>{clip(e.url)}</code></td>
                    <td className="clip">{e.host || '-'}</td>
                  </tr>
                ))}
                {endpoints.length === 0 && (
                  <tr><td colSpan={2} className="muted">None found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* Arrays (HTTP) — COLLAPSIBLE */}
      <section>
        <details open={arrays.length > 0}>
          <summary>
            <strong>Arrays (JSON)</strong>{' '}
            <span className="muted">({arrays.length})</span>
          </summary>
          <div style={{ paddingTop: '.5rem' }}>
            <table>
              <thead><tr><th>Source</th><th>Path</th><th>Length</th><th>Sample</th></tr></thead>
              <tbody>
                {arrays.map((a,i) => (
                  <tr key={i}>
                    <td className="clip"><code>{clip(a.sourceUrl)}</code></td>
                    <td className="clip"><code>{clip(a.path, 32)}</code></td>
                    <td>{a.length}</td>
                    <td><code>{clip(JSON.stringify(a.sample), 38)}</code></td>
                  </tr>
                ))}
                {arrays.length === 0 && (
                  <tr><td colSpan={4} className="muted">None found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* Data Points Overview — COLLAPSIBLE */}
      <section>
        <details open={!!datapoints.length}>
          <summary>
            <strong>Data Points Overview</strong>{' '}
            <span className="muted">
              ({datapoints.length} {datapoints.length === 1 ? 'field' : 'fields'})
            </span>
          </summary>
          <div style={{ paddingTop: '.5rem' }}>
            {!datapoints.length && (
              <p className="muted">
                No runtime arrays summarized yet. Enable “Use headless browser” and consider
                turning off “Same-origin only” if your APIs are on another host.
              </p>
            )}
            {!!datapoints.length && (
              <table>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Present</th>
                    <th>Coverage</th>
                    <th>Types</th>
                    <th>Min</th>
                    <th>Max</th>
                    <th>Examples</th>
                  </tr>
                </thead>
                <tbody>
                  {datapoints.map((r, i) => (
                    <tr key={i}>
                      <td className="clip">
                        <code title={Array.from(r.sources || []).join('\n')}>
                          {r.entity}.{r.field}
                        </code>
                      </td>
                      <td>{r.present}/{r.total || 0}</td>
                      <td>{pct(r.present, r.total)}</td>
                      <td className="clip">
                        <code>
                          {Object.keys(r.types || {}).slice(0, 4).join(', ')}
                          {Object.keys(r.types || {}).length > 4 ? '…' : ''}
                        </code>
                      </td>
                      <td>{r.min !== undefined ? r.min : r.hasDateLike ? 'date-like' : '—'}</td>
                      <td>{r.max !== undefined ? r.max : r.hasDateLike ? 'date-like' : '—'}</td>
                      <td className="clip">
                        <code title={JSON.stringify(r.examples)}>
                          {clip(JSON.stringify(r.examples), 64)}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </details>
      </section>
<div></div>
      {/* Runtime Arrays (Browser) — COLLAPSIBLE (de-duplicated) */}
      <section>
        <details>
          <summary>
            <strong>Runtime Arrays (Browser)</strong>{' '}
            <span className="muted">({runtimeCount} after de-dup; raw {runtimeCountRaw})</span>
          </summary>
          <div style={{ paddingTop: '.5rem' }}>
            {!runtime.length && (
              <p className="muted">
                None captured (try disabling “Same-origin only” if your APIs are on another host).
              </p>
            )}
            {runtime.map((a, i) => (
              <details key={i} style={{ marginBottom: '.5rem' }}>
                <summary>
                  <span className="badge">{a.method}</span>{' '}
                  <code title={a.atUrl}>
                    {clip((() => { try {
                      const u = new URL(a.atUrl)
                      return `${hostOf(a.atUrl)}${u.pathname}`
                    } catch { return a.atUrl || '' } })(), 56)}
                  </code>{' '}
                  · <code>{a.path}</code> · len {a.length} (scanned {a.scanned ?? a.sample?.length ?? 0})
                </summary>
                <div style={{ padding: '.5rem 0 0 0' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Present</th>
                        <th>Coverage</th>
                        <th>Types</th>
                        <th>Min</th>
                        <th>Max</th>
                        <th>Examples</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(a.fieldStats || synthesizeFieldStatsFromSample(a).fieldStats)
                        .map(([k, s]) => (
                        <tr key={k}>
                          <td className="clip"><code>{k}</code></td>
                          <td>{(s.present || 0)}/{a.scanned ?? a.sample?.length ?? 0}</td>
                          <td>{pct(s.present || 0, a.scanned ?? a.sample?.length ?? 0)}</td>
                          <td className="clip">
                            <code>{Object.keys(s.types || {}).slice(0, 4).join(', ')}</code>
                          </td>
                          <td>
                            {s.numeric && typeof s.numeric.min === 'number'
                              ? s.numeric.min
                              : s.hasDateLike ? 'date-like' : '—'}
                          </td>
                          <td>
                            {s.numeric && typeof s.numeric.max === 'number'
                              ? s.numeric.max
                              : s.hasDateLike ? 'date-like' : '—'}
                          </td>
                          <td className="clip">
                            <code title={JSON.stringify(s.examples)}>
                              {clip(JSON.stringify(s.examples || []), 64)}
                            </code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        </details>
      </section>

      {/* Images — COLLAPSIBLE */}
      <section>
        <details open={images.length > 0}>
          <summary>
            <strong>Images</strong>{' '}
            <span className="muted">({images.length})</span>
          </summary>
          <div style={{ paddingTop: '.5rem' }}>
            <table>
              <thead><tr><th>Image</th></tr></thead>
              <tbody>
                {images.map((u,i) => (
                  <tr key={i}>
                    <td><code className="clip" title={u}>{clip(u, 48)}</code></td>
                  </tr>
                ))}
                {images.length === 0 && (
                  <tr><td className="muted">None found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* Provenance — COLLAPSIBLE */}
      <section>
        <details open={provenance.length > 0}>
          <summary>
            <strong>Provenance</strong>{' '}
            <span className="muted">({provenance.length})</span>
          </summary>
          <div style={{ paddingTop: '.5rem' }}>
            <table>
              <thead><tr><th>Image</th><th>Sources</th></tr></thead>
              <tbody>
                {provenance.map((p,i) => (
                  <tr key={i}>
                    <td className="clip"><code title={p.imageUrl}>{clip(p.imageUrl, 48)}</code></td>
                    <td>
                      {p.sources.map((s,j) => (
                        <div className="small clip" key={j} title={s}>{clip(s, 72)}</div>
                      ))}
                    </td>
                  </tr>
                ))}
                {provenance.length === 0 && (
                  <tr><td colSpan={2} className="muted">None recorded</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* Logs — COLLAPSIBLE (closed by default) */}
      <section>
        <details>
          <summary>
            <strong>Logs</strong>{' '}
            <span className="muted">({logs.length})</span>
          </summary>
          <div style={{ paddingTop: '.5rem' }}>
            <pre>{logs.map((l) => `[${l.level}] ${l.msg}`).join('\n')}</pre>
          </div>
        </details>
      </section>
    </div>
  )
}
