// server/filelog.mjs
import { promises as fs } from 'node:fs'
import path from 'node:path';

export const defaultLogDir =
  process.env.LOG_DIR && process.env.LOG_DIR.trim()
    ? process.env.LOG_DIR
    : path.join(process.cwd(), 'logs');
    

// boot-time hint
console.log('[logs] process.cwd() =', process.cwd())
console.log('[logs] LOG_DIR env    =', process.env.LOG_DIR || '(not set)')
console.log('[logs] defaultLogDir  =', defaultLogDir)

export async function ensureLogDir(dir = defaultLogDir) {
  try {
    await fs.mkdir(dir, { recursive: true })
    // sanity check: can we write?
    const probe = path.join(dir, '.write-probe')
    await fs.writeFile(probe, String(Date.now()), 'utf8')
    await fs.rm(probe)
    console.log('[logs] ensured dir  =', dir)
    return dir
  } catch (e) {
    console.error('[logs] ensureLogDir FAILED:', dir, e)
    throw e
  }
}

export function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

export function safeSlug(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'scan'
}

/**
 * Write scan result & logs to disk.
 * formats: any of ['json','ndjson','csv']
 */
export async function writeScanArtifacts(result, { dir = defaultLogDir, formats = ['json', 'ndjson'] } = {}) {
  console.log('[logs] writeScanArtifacts called with formats =', formats, 'dir =', dir)
  await ensureLogDir(dir)

  let host = 'scan'
  try { host = new URL(result?.summary?.seedUrl || '').host || 'scan' } catch {}
  const base = `${timestamp()}_${safeSlug(host)}`
  console.log('[logs] base filename =', base)

  const files = []

  if (formats.includes('json')) {
    const p = path.join(dir, `${base}.result.json`)
    await fs.writeFile(p, JSON.stringify(result, null, 2), 'utf8')
    files.push(p)
    console.log('[logs] wrote JSON   =', p)
  }

  if (formats.includes('ndjson') && Array.isArray(result?.logs)) {
    const p = path.join(dir, `${base}.logs.ndjson`)
    const lines = result.logs.map((l) => JSON.stringify(l)).join('\n') + '\n'
    await fs.writeFile(p, lines, 'utf8')
    files.push(p)
    console.log('[logs] wrote NDJSON =', p)
  }

  if (formats.includes('csv') && result?.byHost) {
    const p = path.join(dir, `${base}.byhost.csv`)
    const rows = ['host,count', ...Object.entries(result.byHost).map(([h, c]) => `${JSON.stringify(h)},${c}`)]
    await fs.writeFile(p, rows.join('\n') + '\n', 'utf8')
    files.push(p)
    console.log('[logs] wrote CSV    =', p)
  }

  console.log('[logs] export DONE, files =', files.length)
  return { dir, files, base }
}
