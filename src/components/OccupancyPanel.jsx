import React, { useEffect, useMemo, useRef, useState } from "react";

/* ---------- tiny helpers ---------- */
function parseJsonSafe(text) {
  try {
    const o = JSON.parse(text);
    return [o && typeof o === "object" ? o : null, null];
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
function isPlainObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}
function clipMiddle(text, max = 64) {
  if (!text || text.length <= max) return text || "";
  const head = Math.ceil((max - 1) * 0.6);
  const tail = (max - 1) - head;
  return text.slice(0, head) + "…" + text.slice(-tail);
}

/* ---------- heuristics for Base URL ---------- */
const AVAIL_HINTS = [
  "availability","available","soldout","sold_out","roomsleft","rooms_left",
  "inventory","bookable","checkin","check_in","checkout","check_out","calendar"
];
function scoreUrl(u = "") {
  const L = u.toLowerCase();
  let s = 0;
  for (const h of AVAIL_HINTS) if (L.includes(h)) s += 2;
  if (/\bapi\b/.test(L)) s += 1;
  if (/[?&](checkin|check_in|from|datefrom)=/.test(L)) s += 1;
  if (/[?&](checkout|check_out|to|dateto)=/.test(L)) s += 1;
  return s;
}
function normalizeCandidatesFromScan(scan) {
  const endpoints = Array.isArray(scan?.endpoints)
    ? scan.endpoints
        .map(e => (typeof e === "string" ? { url: e } : { url: e?.url }))
        .filter(Boolean)
    : [];
  const apiCandidates = Array.isArray(scan?.browser?.apiCandidates)
    ? scan.browser.apiCandidates
        .map(c => ({ url: c?.url, method: c?.method, contentType: c?.contentType }))
        .filter(x => x?.url)
    : [];
  return { endpoints, apiCandidates };
}
function pickBestBaseUrl(scan) {
  const { endpoints, apiCandidates } = normalizeCandidatesFromScan(scan);
  const pool = [
    ...apiCandidates.map(x => x.url),
    ...endpoints.map(x => x.url),
  ].filter(Boolean);
  let best = null, bestScore = -1;
  for (const u of pool) {
    const sc = scoreUrl(u);
    if (sc > bestScore) { best = u; bestScore = sc; }
  }
  return best || scan?.summary?.seedUrl || "";
}

/* ---------- param key prefill ---------- */
const CATEGORY_PARAM_HINTS = {
  accommodation: {
    checkIn:  ['checkin','check_in','datefrom','from','arrival','ci'],
    checkOut: ['checkout','check_out','dateto','to','departure','co'],
    adults:   ['adults','group_adults','guests','pax'],
    venueId:  ['venueid','hotelid','propertyid','id','hotel_id','property_id'],
  }
};
function prefillParamKeysFromUrl(sampleUrl, setters, cat = 'accommodation') {
  try {
    const u = new URL(sampleUrl);
    const keys = Array.from(u.searchParams.keys()).map(k => k.toLowerCase());
    const hints = CATEGORY_PARAM_HINTS[cat] || CATEGORY_PARAM_HINTS.accommodation;
    const pick = list => list.find(h => keys.includes(h));
    const ci = pick(hints.checkIn);
    const co = pick(hints.checkOut);
    const ad = pick(hints.adults);
    const vi = pick(hints.venueId);
    if (ci) setters.setCheckInKey(ci);
    if (co) setters.setCheckOutKey(co);
    if (ad) setters.setAdultsKey(ad);
    if (vi) setters.setVenueIdKey(vi);
  } catch {}
}

/* ---------- Component ---------- */
export default function OccupancyPanel() {
  const [scanText, setScanText] = useState("");
  const [BASE_URL, setBASE_URL] = useState("");
  const [checkInKey, setCheckInKey] = useState("checkin");
  const [checkOutKey, setCheckOutKey] = useState("checkout");
  const [adultsKey, setAdultsKey] = useState("adults");
  const [venueIdKey, setVenueIdKey] = useState("venueId");

  const today = useMemo(() => toISO(new Date()), []);
  const tomorrow = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 1); return toISO(d); }, []);
  const [fromISO, setFromISO] = useState(today);
  const [toISOIncl, setToISOIncl] = useState(tomorrow);
  const [nights, setNights] = useState(1);

  const [extractBusy, setExtractBusy] = useState(false);
  const [extractErr, setExtractErr] = useState("");
  const [result, setResult] = useState(null);

  const fileRef = useRef(null);

  const scanDerived = useMemo(() => {
    const [obj] = parseJsonSafe(scanText);
    if (!obj) return { scan: null, pool: [], best: "", scored: [] };
    const { endpoints, apiCandidates } = normalizeCandidatesFromScan(obj);
    const pool = [
      ...apiCandidates.map(x => x.url),
      ...endpoints.map(x => x.url),
    ].filter(Boolean);
    const scored = pool
      .map(u => ({ u, s: scoreUrl(u) }))
      .sort((a, b) => (b.s - a.s) || (a.u.length - b.u.length));
    const best = pickBestBaseUrl(obj);
    return { scan: obj, pool, best, scored };
  }, [scanText]);

  useEffect(() => {
    if (scanText) return;
    try {
      const ls =
        localStorage.getItem("uniscanner:lastScan") ||
        localStorage.getItem("scan:last") ||
        localStorage.getItem("apiBoard:lastScan");
      if (ls) setScanText(ls);
    } catch {}
  }, [scanText]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (scanText && scanText.trim()) localStorage.setItem("uniscanner:lastScan", scanText);
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [scanText]);

  useEffect(() => {
    if (BASE_URL && BASE_URL.trim()) return;
    if (!scanDerived.scan) return;
    const candidate = scanDerived.best;
    if (candidate) {
      setBASE_URL(candidate);
      prefillParamKeysFromUrl(
        candidate,
        { setCheckInKey, setCheckOutKey, setAdultsKey, setVenueIdKey },
        "accommodation"
      );
    }
  }, [scanDerived.scan, scanDerived.best, BASE_URL]);

  async function doExtract() {
    setExtractErr("");
    setExtractBusy(true);
    try {
      if (!BASE_URL || !BASE_URL.trim()) throw new Error("Please enter a Base URL.");
      const dates = buildDates(fromISO, toISOIncl, nights);
      if (!dates.length) throw new Error("Invalid date range.");

      const payload = {
        BASE_URL: BASE_URL.trim(),
        method: "GET",
        paramMap: {
          checkIn: checkInKey || "checkin",
          checkOut: checkOutKey || "checkout",
          ...(adultsKey ? { adults: adultsKey } : {}),
          ...(venueIdKey ? { venueId: venueIdKey } : {}),
          extra: {},
        },
        adults: 2,
        dates,
        interpret: { path: "ok", op: "truthy" },
        throttleMs: 80,
      };

      const res = await fetch("/api/occupancy/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json")
        ? await res.json()
        : { ok: false, error: await res.text() };

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

  function applyCandidate(u) {
    setBASE_URL(u);
    prefillParamKeysFromUrl(
      u,
      { setCheckInKey, setCheckOutKey, setAdultsKey, setVenueIdKey },
      "accommodation"
    );
  }

  function onImportFile(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const txt = String(reader.result || "");
        const [obj, err] = parseJsonSafe(txt);
        if (err || !obj) {
          alert("Invalid JSON file.");
          ev.target.value = "";
          return;
        }
        const pretty = JSON.stringify(obj, null, 2);
        setScanText(pretty);
        try { localStorage.setItem("uniscanner:lastScan", pretty); } catch {}
      } catch (e) {
        alert("Failed to load file: " + (e?.message || e));
      } finally {
        ev.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="grid gap-4">
      <h2 className="text-xl font-semibold">Occupancy (API-only, fast) — v1</h2>

      {/* Scan Card */}
      <section className="card bg-base-100 border border-base-200">
        <div className="card-body gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="card-title">Scan</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-sm"
                title="Load last scan from localStorage"
                onClick={() => {
                  try {
                    const ls =
                      localStorage.getItem("uniscanner:lastScan") ||
                      localStorage.getItem("scan:last") ||
                      localStorage.getItem("apiBoard:lastScan");
                    if (ls) setScanText(ls);
                  } catch {}
                }}
              >
                Load from local
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                onChange={onImportFile}
                className="hidden"
              />
              <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                Import JSON…
              </button>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setScanText("")}>
                Clear
              </button>
            </div>
          </div>

          {scanDerived.scan?.summary && (
            <div className="flex flex-wrap gap-2 text-sm text-base-content/70">
              <span className="badge badge-ghost">seed: {scanDerived.scan.summary.seedUrl}</span>
              <span className="badge badge-ghost">pages: {scanDerived.scan.summary.pagesScanned}</span>
              <span className="badge badge-ghost">endpoints: {scanDerived.scan.summary.endpointsFound}</span>
              <span className="badge badge-ghost">browser reqs: {scanDerived.scan.summary.browserTotalRequests}</span>
              <span className="badge badge-ghost">
                API candidates: {Array.isArray(scanDerived.scan?.browser?.apiCandidates) ? scanDerived.scan.browser.apiCandidates.length : 0}
              </span>
              {scanDerived.scan.summary.category && (
                <span className="badge badge-ghost">category: {scanDerived.scan.summary.category}</span>
              )}
            </div>
          )}

          <textarea
            value={scanText}
            onChange={(e) => setScanText(e.target.value)}
            placeholder='{"summary":{"seedUrl":"https://example.com"},"endpoints":[{"url":"https://api.example.com/availability?checkin=..."}]}'
            rows={8}
            className="textarea textarea-bordered font-mono"
          />

          {scanDerived.scored.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm text-base-content/70">
                <strong>Top URL candidates</strong> (click to apply):
              </div>
              <div className="flex flex-wrap gap-2">
                {scanDerived.scored.slice(0, 8).map(({ u, s }) => (
                  <button
                    key={u + s}
                    type="button"
                    title={u}
                    onClick={() => applyCandidate(u)}
                    className="btn btn-xs btn-outline normal-case"
                  >
                    {s > 0 ? `★${s} ` : ""}{clipMiddle(u, 72)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Extract Card */}
      <section id="extract-section" className="card bg-base-100 border border-base-200">
        <div className="card-body gap-4">
          <h3 className="card-title">Extract</h3>

          <label className="form-control w-full">
            <div className="label"><span className="label-text">Base URL</span></div>
            <input
              value={BASE_URL}
              onChange={(e) => setBASE_URL(e.target.value)}
              onBlur={(e) =>
                prefillParamKeysFromUrl(
                  e.target.value,
                  { setCheckInKey, setCheckOutKey, setAdultsKey, setVenueIdKey },
                  "accommodation"
                )
              }
              placeholder="https://api.example.com/availability"
              list="baseurl-suggestions"
              className="input input-bordered w-full"
            />
            <datalist id="baseurl-suggestions">
              {scanDerived.scored.slice(0, 10).map(({ u }) => (
                <option value={u} key={u} />
              ))}
              {scanDerived.best && <option value={scanDerived.best} />}
            </datalist>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="form-control">
              <div className="label"><span className="label-text">check-in key</span></div>
              <input className="input input-bordered" value={checkInKey} onChange={(e) => setCheckInKey(e.target.value)} />
            </label>
            <label className="form-control">
              <div className="label"><span className="label-text">check-out key</span></div>
              <input className="input input-bordered" value={checkOutKey} onChange={(e) => setCheckOutKey(e.target.value)} />
            </label>
            <label className="form-control">
              <div className="label"><span className="label-text">adults key (opt)</span></div>
              <input className="input input-bordered" value={adultsKey} onChange={(e) => setAdultsKey(e.target.value)} placeholder="adults" />
            </label>
            <label className="form-control">
              <div className="label"><span className="label-text">venueId key (opt)</span></div>
              <input className="input input-bordered" value={venueIdKey} onChange={(e) => setVenueIdKey(e.target.value)} placeholder="venueId" />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="form-control">
              <div className="label"><span className="label-text">from (YYYY-MM-DD)</span></div>
              <input className="input input-bordered" value={fromISO} onChange={(e) => setFromISO(e.target.value)} />
            </label>
            <label className="form-control">
              <div className="label"><span className="label-text">to (YYYY-MM-DD)</span></div>
              <input className="input input-bordered" value={toISOIncl} onChange={(e) => setToISOIncl(e.target.value)} />
            </label>
            <label className="form-control">
              <div className="label"><span className="label-text">nights</span></div>
              <input type="number" min={1} className="input input-bordered" value={nights} onChange={(e) => setNights(Number(e.target.value || 1))} />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={doExtract} disabled={extractBusy || !BASE_URL} className="btn btn-primary">
              {extractBusy ? "Extracting…" : "Extract"}
            </button>
            {extractErr && <span className="text-error text-sm">{extractErr}</span>}
          </div>

          {result && (
            <div className="space-y-2">
              <div className="text-sm text-base-content/70">
                {(() => {
                  const total = Array.isArray(result?.results) ? result.results.length : 0;
                  const failed = typeof result?.summary?.errors === "number"
                    ? result.summary.errors
                    : (Array.isArray(result?.results) ? result.results.filter(r => r.error).length : 0);
                  return <>ok=<b>{String(!!result.ok)}</b> • total=<b>{total}</b> • failed=<b>{failed}</b> • ms=<b>{result?.ms ?? "-"}</b></>;
                })()}
              </div>

              <div className="overflow-x-auto">
                <table className="table table-zebra">
                  <thead>
                    <tr>
                      <th>date</th>
                      <th>occupied</th>
                      <th>url</th>
                      <th>raw keys / error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.results || []).map((r, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap">{r.id || r.checkIn}</td>
                        <td className="whitespace-nowrap">{String(r.occupied)}</td>
                        <td className="whitespace-nowrap">
                          {r.url ? <a className="link link-primary" href={r.url} target="_blank" rel="noreferrer">link</a> : "-"}
                        </td>
                        <td className="text-sm">
                          {r.error
                            ? <span className="text-error">{r.error}</span>
                            : (r.raw && typeof r.raw === "object" ? Object.keys(r.raw).slice(0, 2).join(", ") : "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
