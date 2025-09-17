import React, { useMemo, useState, useEffect  } from "react";

/** helpers */
function parseJsonSafe(text) {
  try {
    const o = JSON.parse(text);
    if (o && typeof o === "object") return [o, null];
    return [null, "Parsed value is not an object"];
  } catch (e) {
    return [null, String(e.message || e)];
  }
}
function toISO(d) {
  const x = new Date(d);
  if (Number.isNaN(+x)) return "";
  return x.toISOString().slice(0, 10);
}
function buildDates(fromISO, toISOIncl, nights = 1) {
  const out = [];
  const from = new Date(fromISO);
  const to = new Date(toISOIncl);
  if (Number.isNaN(+from) || Number.isNaN(+to)) return out;
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const ci = toISO(d);
    const coD = new Date(d);
    coD.setDate(coD.getDate() + Number(nights || 1));
    out.push({ id: ci, checkIn: ci, checkOut: toISO(coD) });
  }
  return out;
}

export function isPlainObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

const CATEGORY_PARAM_HINTS = {
  accommodation: {
    checkIn:  ['checkin','check_in','datefrom','from','arrival'],
    checkOut: ['checkout','check_out','dateto','to','departure'],
    adults:   ['adults','group_adults','guests','pax'],
    venueId:  ['venueid','hotelid','propertyid','id'],
  },
  // auctions: { ... }   // add later
  // social:   { ... }   // add later
};


export default function OccupancyPanel({ initialScan = null, category = 'accommodation', }) {
  // --- Discover state
  const [scanText, setScanText] = useState("");
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [discoverErr, setDiscoverErr] = useState("");

  // --- Extract state
  const today = useMemo(() => toISO(new Date()), []);
  const tomorrow = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); return toISO(d);
  }, []);
  const [baseUrl, setBaseUrl] = useState("");
  const [checkInKey, setCheckInKey] = useState("checkin");
  const [checkOutKey, setCheckOutKey] = useState("checkout");
  const [adultsKey, setAdultsKey] = useState("adults");
  const [venueIdKey, setVenueIdKey] = useState("venueId");
  const [extraKV, setExtraKV] = useState(`{ "currency": "EUR" }`);
  const [venueId, setVenueId] = useState("");
  const [adults, setAdults] = useState(2);
  const [fromISO, setFromISO] = useState(today);
  const [toISOIncl, setToISOIncl] = useState(tomorrow);
  const [nights, setNights] = useState(1);
  const [path, setPath] = useState("data.roomsLeft");
  const [op, setOp] = useState("gt"); // truthy | gt | eq | lt
  const [value, setValue] = useState("0");
  const [throttleMs, setThrottleMs] = useState(80);

  const [extractBusy, setExtractBusy] = useState(false);
  const [extractErr, setExtractErr] = useState("");
  const [result, setResult] = useState(null);





function prefillParamKeysFromUrl(u, categoryName = 'accommodation') {
  try {
    const url = new URL(u);
    const qp = Object.fromEntries(url.searchParams.entries());
    const keys = Object.keys(qp).map(k => k.toLowerCase());

    // 1) Try to map from URL query param names using category hints
    const hints = CATEGORY_PARAM_HINTS[categoryName] || CATEGORY_PARAM_HINTS.accommodation;
    const findFirst = (alts) => keys.find(k => alts.includes(k));

    const ci = findFirst((hints.checkIn || []).map(s => s.toLowerCase()));
    const co = findFirst((hints.checkOut || []).map(s => s.toLowerCase()));
    const ad = findFirst((hints.adults || []).map(s => s.toLowerCase()));
    const vid = findFirst((hints.venueId || []).map(s => s.toLowerCase()));

    if (ci) setCheckInKey(ci);
    if (co) setCheckOutKey(co);
    if (ad) setAdultsKey(ad);
    if (vid) setVenueIdKey(vid);

    // 2) If URL params didn’t give enough, keep your existing heuristics as fallback (optional)
    // (You can add JSON-body heuristics here later when we probe responses.)

  } catch (_) {
    // ignore parsing errors
  }
}

  
  async function doDiscover() {
    setDiscoverErr("");
    setDiscoverBusy(true);
    try {
      const [obj, err] = parseJsonSafe(scanText.trim());
      if (err) throw new Error(`Invalid JSON: ${err}`);
      const res = await fetch("/api/occupancy/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(obj),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      
    } catch (e) {
      setDiscoverErr(String(e.message || e));
      setCandidates([]);
      if (!baseUrl && Array.isArray(data.candidates) && data.candidates.length) {
  const first = data.candidates[0];
  setBaseUrl(first.url || "");
  prefillParamKeysFromUrl(first.url);
}
    } finally {
      setDiscoverBusy(false);
    }
  }

  async function doExtract() {
    setExtractErr("");
    setExtractBusy(true);
    try {
      const dates = buildDates(fromISO, toISOIncl, nights);
      if (!dates.length) throw new Error("Invalid date range.");
      let extraObj = {};
      if (extraKV.trim()) {
        const [o, err] = parseJsonSafe(extraKV.trim());
        if (err) throw new Error(`Extra params JSON invalid: ${err}`);
        extraObj = o;
      }
      const payload = {
        baseUrl,
        method: "GET",
        paramMap: {
          checkIn: checkInKey,
          checkOut: checkOutKey,
          ...(adultsKey ? { adults: adultsKey } : {}),
          ...(venueIdKey ? { venueId: venueIdKey } : {}),
          extra: extraObj,
        },
        venueId: venueId || undefined,
        adults: Number(adults) || 1,
        dates,
        interpret: {
          path,
          op,
          ...(op === "gt" || op === "lt" || op === "eq" ? { value: isNaN(+value) ? value : +value } : {}),
        },
        throttleMs: Number(throttleMs) || 80,
      };

      const res = await fetch("/api/occupancy/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setResult(data);
    } catch (e) {
      setExtractErr(String(e.message || e));
      setResult(null);
    } finally {
      setExtractBusy(false);
    }
  }

  function useCandidate(url) {setBaseUrl(url || "");
prefillParamKeysFromUrl(url, category);
document.getElementById("extract-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

useEffect(() => {
  if (isPlainObject(initialScan)) {
    // pretty-print the scan JSON into the textarea
    setScanText(JSON.stringify(initialScan, null, 2));
  }
}, [initialScan]);


  return (
  <div className="occupancy-panel" style={{ display: "grid", gap: 16 }}>
    <h2>Occupancy</h2>

    {/* Discover */}
    <section className="card" style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
  <h3>1) Discover availability endpoints from a scan</h3>
  <p className="muted">
    Paste a saved scan JSON (from /api/scan) and click Discover, or load the current scan.
  </p>

  <textarea
    value={scanText}
    onChange={(e) => setScanText(e.target.value)}
    placeholder="Paste scan JSON here…"
    rows={10}
    style={{ width: "100%", fontFamily: "ui-monospace, monospace" }}
  />

  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
    {isPlainObject(initialScan) && (
      <button
        type="button"
        onClick={() => setScanText(JSON.stringify(initialScan, null, 2))}
        title="Load the latest scan JSON into the box"
      >
        Use current scan
      </button>
    )}

    <button onClick={doDiscover} disabled={discoverBusy}>
      {discoverBusy ? "Discovering…" : "Discover"}
    </button>

    {discoverErr && <span style={{ color: "crimson" }}>{discoverErr}</span>}
  </div>

  {Array.isArray(candidates) && candidates.length > 0 && (
    <div style={{ marginTop: 10 }}>
      <strong>Candidates ({candidates.length})</strong>
      <ul>
        {candidates.map((c, i) => (
          <li key={i}>
            <code>{c.url}</code>{" "}
            {Array.isArray(c.hints) && c.hints.length ? (
              <small style={{ color: "#666" }}>hints: {c.hints.join(", ")}</small>
            ) : null}
            <button style={{ marginLeft: 8 }} onClick={() => useCandidate(c.url)}>
              Use
            </button>
          </li>
        ))}
      </ul>
    </div>
  )}
</section>


      {/* Extract */}
      <section id="extract-section" className="card" style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <h3>2) Extract occupancy (API-only, fast)</h3>
        <div style={{ display: "grid", gap: 8 }}>
          <label>
            Base URL
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/availability" />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            <label>
              check-in key
              <input value={checkInKey} onChange={(e) => setCheckInKey(e.target.value)} />
            </label>
            <label>
              check-out key
              <input value={checkOutKey} onChange={(e) => setCheckOutKey(e.target.value)} />
            </label>
            <label>
              adults key
              <input value={adultsKey} onChange={(e) => setAdultsKey(e.target.value)} placeholder="adults" />
            </label>
            <label>
              venueId key
              <input value={venueIdKey} onChange={(e) => setVenueIdKey(e.target.value)} placeholder="venueId" />
            </label>
          </div>

          <label>
            Extra query params (JSON object)
            <textarea rows={3} value={extraKV} onChange={(e) => setExtraKV(e.target.value)} />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            <label>
              venueId
              <input value={venueId} onChange={(e) => setVenueId(e.target.value)} />
            </label>
            <label>
              adults
              <input type="number" min={1} value={adults} onChange={(e) => setAdults(e.target.value)} />
            </label>
            <label>
              from (YYYY-MM-DD)
              <input value={fromISO} onChange={(e) => setFromISO(e.target.value)} />
            </label>
            <label>
              to (YYYY-MM-DD, inclusive)
              <input value={toISOIncl} onChange={(e) => setToISOIncl(e.target.value)} />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            <label>
              nights
              <input type="number" min={1} value={nights} onChange={(e) => setNights(e.target.value)} />
            </label>
            <label>
              throttle ms
              <input type="number" min={0} value={throttleMs} onChange={(e) => setThrottleMs(e.target.value)} />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
            <label>
              interpret path
              <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="data.roomsLeft or soldOut" />
            </label>
            <label>
              op
              <select value={op} onChange={(e) => setOp(e.target.value)}>
                <option value="truthy">truthy</option>
                <option value="gt">gt</option>
                <option value="eq">eq</option>
                <option value="lt">lt</option>
              </select>
            </label>
            <label>
              value
              <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="used for gt/eq/lt" />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={doExtract} disabled={extractBusy || !baseUrl}>
              {extractBusy ? "Extracting…" : "Extract"}
            </button>
            {extractErr && <span style={{ color: "crimson" }}>{extractErr}</span>}
          </div>
        </div>

        {result && (
          <div style={{ marginTop: 12 }}>
            <strong>Result</strong>
            <div style={{ fontSize: 12, color: "#555" }}>
              ok={result.ok ? "true" : "false"} total={result.total} ok={result.ok} failed={result.failed} ms={result.ms}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>date</th>
                  <th style={{ textAlign: "left" }}>occupied</th>
                  <th style={{ textAlign: "left" }}>url</th>
                  <th style={{ textAlign: "left" }}>raw (first 1–2 keys)</th>
                </tr>
              </thead>
              <tbody>
                {(result.results || []).map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #eee" }}>
                    <td>{r.id || r.checkIn}</td>
                    <td>{String(r.occupied)}</td>
                    <td>
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer">
                          link
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      {r.raw && typeof r.raw === "object"
                        ? Object.keys(r.raw)
                            .slice(0, 2)
                            .map((k) => k)
                            .join(", ")
                        : r.error || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
