# Universal Scanner (starter)

A minimal, DRY starter for a "universal machine" that scans any URL server-side and extracts:

- **Endpoints:** URL-like strings from HTML/JSON/XML (by host overview).
- **Self-describing docs:** OpenAPI/Swagger, JSON-LD, Hydra, HAL, JSON Schema, Snowplow Iglu.
- **Arrays:** JSON paths with lengths and small samples.
- **Image provenance:** `imageUrl -> sources` (which responses referenced it).
- **Browser capture (Playwright):** collect **XHR/Fetch/GraphQL** requests that actually populate SPAs.

## Quick start

```bash
# Node 18+
npm i
npm run dev
# open http://localhost:5173
```

> The first install runs `npx playwright install chromium` to download a local browser for capture.

The Vite dev server proxies `/api/*` to the Express server at `5174`.

## Modes

- **HTTP** (default): server-side fetch (no JS execution). Fast, no CORS issues, but won't see client-side XHR.
- **Browser**: headless Chromium via Playwright. Sees **XHR/Fetch/GraphQL** the page triggers.
- **Both**: merges results (UI has a checkbox “Use headless browser”).

### Why browser mode?

Single-page apps populate content via `fetch`/XHR/GraphQL after initial HTML load. Those calls are **not discoverable** with plain HTTP fetches because they are triggered **by runtime JavaScript**. Headless browsing executes the JS and surfaces those requests. (Playwright exposes request/response events; you can also capture request payloads for GraphQL.) References: MDN Fetch basics & opaque responses; Playwright network events.  
- MDN Fetch: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch  
- Playwright network: https://playwright.dev/docs/network

## API

`POST /api/scan`
```json
{
  "url": "https://example.com",
  "maxDepth": 0,
  "sameOrigin": true,
  "maxPages": 6,
  "timeoutMs": 15000,
  "mode": "http | browser | both"
}
```

Returns JSON with `summary`, `endpoints`, `images`, `provenance`, `selfDescribing`, `arrays`, `byHost`, `logs`, and (in browser/both) a `browser` object containing `apiCandidates` (XHR/Fetch/GraphQL).

## Legal & ethical

Respect each site's Terms of Service and `robots.txt`, and throttle/limit requests. This tool is for **observational debugging** under your control.

## References

- **CORS / opaque responses (MDN):** https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
- **RequestInit.mode (MDN):** https://developer.mozilla.org/en-US/docs/Web/API/RequestInit
- **Playwright network:** https://playwright.dev/docs/network
- **JSON-LD spec:** https://www.w3.org/TR/json-ld11/
- **JSON-LD vocab:** https://www.w3.org/ns/json-ld
- **Hydra Core vocabulary:** https://www.hydra-cg.com/spec/latest/core/
- **HAL spec:** https://stateless.group/hal_specification.html
- **OpenAPI 3.x:** https://spec.openapis.org/oas/v3.1.0.html
- **OpenAPI field (swagger.io):** https://swagger.io/specification/
- **Snowplow self-describing:** https://docs.snowplow.io/docs/api-reference/iglu/common-architecture/self-describing-jsons/
