# Universal Scanner

A small, **DRY** tool that inspects any website to reveal the data sources that power it.

It runs two complementary passes:

- **HTTP scan (server-side fetch):** crawls pages, extracts URLs, self-describing docs (OpenAPI/Swagger, JSON-LD/Hydra, HAL, JSON Schema), images & provenance, and JSON arrays.
- **Browser capture (Playwright):** executes the page and records real **XHR/Fetch/GraphQL** calls. It summarizes arrays in JSON responses (fields, coverage, types, numeric ranges, examples) and aggregates a **Data Points Overview** for a human-readable snapshot of the data model.

Everything renders in a minimal Vite + React UI with **collapsible sections**, and you can **export results to disk**.

---

## ✨ Features

- **Server HTTP scanner**
  - BFS with depth & same-origin controls
  - HTML/JSON/XML extractors
  - Self-describing detectors: OpenAPI/Swagger / JSON-LD / Hydra / HAL / JSON Schema
  - Image URL provenance
  - Lightweight array samples (HTTP path)

- **Headless browser capture**
  - Records **XHR/Fetch/GraphQL** at runtime
  - Universal **array summarizer**:
    - path, length, columns (union of keys), per-field stats (present/nullish, type tallies, numeric min/max, date-like, examples)
  - **Data Points Overview**: field-level rollup like `venues.name`, `venues.id`, `venues.price` with coverage & examples
  - **De-duplication** of overlapping arrays (e.g., paged vs full search) by `(entity + column signature)`—keeps the richest set

- **UI**
  - Clean, responsive tables
  - **All sections expandable/collapsible**
  - De-dup counts shown (raw vs after de-dup)

- **Export**
  - Saves results to `/logs` (or `LOG_DIR`) as:
    - `*.result.json` (full result)
    - `*.logs.ndjson` (line-delimited logs)
    - `*.byhost.csv` (optional)

---

## 🧱 Project Structure

```
.
├─ server/
│  ├─ index.mjs              # Express API (/api/scan), export-to-disk integration
│  ├─ scan.mjs               # HTTP scanner (fetch + parsers)
│  ├─ browser.mjs            # Playwright headless browser capture
│  ├─ detectors.mjs          # Self-describing & array helpers
│  ├─ array-summary.mjs      # Universal JSON array summarizer (field stats)
│  ├─ provenance.mjs         # Image provenance index
│  └─ filelog.mjs            # Log dir, export writers (json/ndjson/csv)
├─ src/
│  ├─ ui/
│  │  ├─ App.jsx             # Controls (seed URL, depth, same-origin, browser, export)
│  │  └─ Results.jsx         # Collapsible sections, overview & tables
│  ├─ main.jsx
│  └─ ...
├─ index.html
├─ vite.config.js
├─ package.json
└─ README.md                 # ← this file
```

---

## 🚀 Quick Start

Prereqs: Node 18+

```bash
npm i
npm run dev
# UI: http://localhost:5173  (proxies to server on http://localhost:5174)
```

The first install will also fetch a local Chromium for Playwright.

---

## 🧭 Usage (UI)

1. **Seed URL** – paste the site root (e.g., `https://www.example.com/`)
2. **Max depth / Max pages** – limits for the HTTP BFS pass
3. **Same-origin only** – toggle off to capture cross-origin APIs (e.g., `api.example.com`)
4. **Use headless browser** – enable runtime capture of XHR/Fetch/GraphQL
5. **Export to /logs** – save results to disk; choose formats (JSON / NDJSON / CSV)

Run **Scan**. Results appear in collapsible sections: Summary, Self-describing, Endpoints, Arrays (HTTP), **Data Points Overview**, **Runtime Arrays (Browser)**, Images, Provenance, Logs.

---

## 🛠 API

### `POST /api/scan`

**Body**
```json
{
  "url": "https://example.com",
  "maxDepth": 0,
  "sameOrigin": true,
  "maxPages": 6,
  "timeoutMs": 15000,
  "mode": "http | browser | both",
  "exportLogs": true,
  "exportFormats": ["json", "ndjson", "csv"],
  "exportDir": "C:/path/to/logs",
  "storage": { "token": "...", "apiKey": "..." }
}
```

- `mode`:  
  - **http** – only server fetch  
  - **browser** – only headless capture  
  - **both** – merge
- `storage` (optional): injects localStorage key/values before page load (useful to pre-auth a SPA).

**Response (shape excerpt)**
```json
{
  "summary": {
    "seedUrl": "...",
    "pagesScanned": 1,
    "endpointsFound": 12,
    "imagesFound": 3,
    "browserApiCandidates": 14,
    "browserTotalRequests": 56
  },
  "endpoints": [{ "url": "...", "host": "..." }],
  "selfDescribing": [{ "url": "...", "info": { "kind": "openapi", "meta": "3.1.0" } }],
  "arrays": [{ "sourceUrl": "...", "path": "$.data.items", "length": 50, "sample": [...] }],
  "browser": {
    "apiCandidates": [{ "url": "...", "method": "GET", "contentType": "application/json" }],
    "arraySummaries": [{
      "atUrl": "...",
      "path": "$.data",
      "length": 872,
      "scanned": 200,
      "columns": ["id","name","price", "..."],
      "fieldStats": { "name": { "present": 872, "types": {"string": 872} } }
    }],
    "byHost": { "api.example.com": 12 }
  },
  "provenance": [{ "imageUrl": "...", "sources": ["html @ ...", "jsonld @ ..."] }],
  "byHost": { "api.example.com": 12, "cdn.example.com": 8 },
  "exported": { "dir": "C:\\dev\\Universal-scanner\\logs", "files": ["...result.json", "...logs.ndjson"] }
}
```

---

## 💾 Exports

- Default directory: **`<project-root>/logs`**  
- Override with `LOG_DIR`:
  - PowerShell: `setx LOG_DIR "C:\dev\Universal-scanner\logs"`
  - Bash: `LOG_DIR="/var/tmp/universal-logs" npm run dev`

File naming: `YYYY-MM-DD_HH-MM-SS_<host>.*`

---

## 🧩 De-duplication (Runtime Arrays)

Sites often return overlapping arrays (e.g., a 100-item list and a full search).  
We group runtime arrays by **entity** (derived from URL path) + **column signature** (sorted top-level keys), and keep the *richest*:

1. larger `length`  
2. then larger `scanned`  
3. then more `columns`

The UI displays **raw vs de-dup counts**.

---

## 🔧 Troubleshooting

- **ECONNREFUSED / proxy error in Vite**  
  Ensure the server started cleanly (look for “listening on 5174”). If the server crashed, the client can’t proxy.

- **XML parser import error**  
  We use `fast-xml-parser` via `XMLParser` constructed from the default export to support both CJS/ESM shapes. If you see import issues, reinstall `fast-xml-parser` and restart.

- **No files in `/logs`**  
  Ensure **Export** is enabled in the UI and the process can write to that path. Check server logs for `[logs]` lines; use `LOG_DIR` to redirect if needed.

- **No API calls captured**  
  Uncheck **Same-origin only** when APIs are on another host. Some pages only fetch data when authenticated; optionally pass `storage` with credentials to pre-seed localStorage.

---

## 🗺️ Roadmap (branch: `feat/deep-nav-finn`)

- DOM deep-links collector (pierce shadow DOM) to follow grid → browse → SRP → items on `www.finn.no`
- Optional consent auto-dismiss
- Configurable nav hints per host (maxDepth, allowPatterns, per-page caps)
- Nav trail reporting

---

## ⚖️ Legal & Ethics

Use responsibly. Respect each site’s Terms and robots policies. Add delays and caps if you automate deeper navigation.

---

## 🧪 Scripts

```jsonc
{
  "dev": "concurrently -k \"npm:dev:*\"",
  "dev:server": "node --watch server/index.mjs",
  "dev:client": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "start": "node server/index.mjs",
  "format": "prettier . --write",
  "postinstall": "npx playwright install chromium"
}
```

---

## 📄 License

MIT (or your choice)
