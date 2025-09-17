// server/routes/scan.mjs
import express from 'express';
import { scanSite } from '../scan.mjs';
import { browseAndCapture } from '../browser.mjs';
import { writeScanArtifacts } from '../filelog.mjs';
import { sumByHost } from '../utils/merge.mjs';
import { normalizeForUI } from '../utils/normalize-ui.mjs';







export function loadRouter(base = '/api/scan') {
  const router = express.Router();

  // ---------- main scan endpoint ----------
  // NOTE: path is '/' because this router is mounted at /api/scan
  router.post('/', async (req, res) => {
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
        navAllowPatterns,
        storage, // optional: localStorage pre-seed for SPAs
      } = req.body || {};

      if (!url) return res.status(400).json({ error: 'Missing url' });

      console.log('[scan] incoming', {
        url,
        maxDepth,
        sameOrigin,
        maxPages,
        timeoutMs,
        mode,
        exportLogs,
        exportFormats,
        exportDir,
        navAllowPatterns,
        hasStorage: !!storage,
      });

      // Base HTTP scan
      const baseHttp = await scanSite({
        seedUrl: url,
        maxDepth: Number(maxDepth),
        sameOrigin: Boolean(sameOrigin),
        maxPages: Number(maxPages),
        timeoutMs: Number(timeoutMs),
      });

      // HTTP-only mode
      if (mode === 'http') {
        let output = baseHttp;
        if (exportLogs) {
          const formats = Array.isArray(exportFormats) ? exportFormats : ['json', 'ndjson'];
          try {
            console.log('[scan] exporting (http) with formats', formats, 'dir', exportDir || '(default)');
            const exported = await writeScanArtifacts(output, { formats, dir: exportDir });
            output = { ...output, exported };
            console.log('[scan] export OK (http)', exported);
          } catch (e) {
            console.error('[scan] export FAIL (http)', e);
            output = { ...output, exportError: String(e) };
          }
        }
        output = normalizeForUI(output);
        return res.json(output);
      }

      // Headless browser capture
      const browserPart = await browseAndCapture({
        url,
        headless: true,
        timeoutMs: Math.max(Number(timeoutMs), 25000),
        sameOrigin: Boolean(sameOrigin),
        autoScroll: true,
        navAllowPatterns,
        storage,
      });

      // Browser-only mode
      if (mode === 'browser') {
        let output = {
          browser: browserPart,
          summary: {
            seedUrl: url,
            browserApiCandidates: browserPart.summary.apiCandidates,
            browserTotalRequests: browserPart.summary.totalRequests,
          }
        };
        if (exportLogs) {
          const formats = Array.isArray(exportFormats) ? exportFormats : ['json', 'ndjson'];
          try {
            console.log('[scan] exporting (browser) with formats', formats, 'dir', exportDir || '(default)');
            const exported = await writeScanArtifacts(output, { formats, dir: exportDir });
            output = { ...output, exported };
            console.log('[scan] export OK (browser)', exported);
          } catch (e) {
            console.error('[scan] export FAIL (browser)', e);
            output = { ...output, exportError: String(e) };
          }
        }
        output = normalizeForUI(output);
        return res.json(output);
      }

      // Both: merge base + browser info
      const merged = {
        ...baseHttp,
        browser: browserPart,
        summary: {
          ...baseHttp.summary,
          browserApiCandidates: browserPart.summary.apiCandidates,
          browserTotalRequests: browserPart.summary.totalRequests,
        },
        byHost: {
          ...baseHttp.byHost,
          ...browserPart.byHost,
        },
      };

      let output = merged;
      if (exportLogs) {
        const formats = Array.isArray(exportFormats) ? exportFormats : ['json', 'ndjson'];
        try {
          console.log('[scan] exporting (both) with formats', formats, 'dir', exportDir || '(default)');
          const exported = await writeScanArtifacts(output, { formats, dir: exportDir });
          output = { ...output, exported };
          console.log('[scan] export OK (both)', exported);
        } catch (e) {
          console.error('[scan] export FAIL (both)', e);
          output = { ...output, exportError: String(e) };
        }
      }
      output = normalizeForUI(output);
      return res.json(output);
    } catch (err) {
      console.error('[scan] fatal', err);
      res.status(500).json({ error: String((err && err.stack) || err) });
    }
  });

  return { base, router };
}
