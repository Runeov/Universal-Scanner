// Self-describing detectors
export function detectSelfDescribing(obj) {
  if (!obj || typeof obj !== 'object') return null

  // JSON Schema hints
  if (obj.$schema || obj.$id) {
    return { kind: 'json-schema', meta: obj.$schema || obj.$id }
  }

  // Snowplow Iglu self-describing JSON
  if (typeof obj.schema === 'string' && obj.schema.startsWith('iglu:')) {
    return { kind: 'iglu', meta: obj.schema }
  }
  if (obj.self && typeof obj.self === 'object' && obj.self.vendor && obj.self.name) {
    return { kind: 'iglu-schema', meta: `${obj.self.vendor}/${obj.self.name}` }
  }

  // OpenAPI / Swagger
  if (obj.openapi || obj.swagger) {
    return { kind: obj.openapi ? 'openapi' : 'swagger', meta: obj.openapi || obj.swagger }
  }

  // JSON-LD (+ possible Hydra)
  if (Object.prototype.hasOwnProperty.call(obj, '@context')) {
    const ctx = obj['@context']
    const toStrs = (v) => Array.isArray(v) ? v.filter(x => typeof x === 'string') : (typeof v === 'string' ? [v] : [])
    const strs = toStrs(ctx)
    const hydra = strs.some(s => s.toLowerCase().includes('hydra')) ||
      (Array.isArray(ctx) && ctx.some(x => x && typeof x === 'object' && String(x['@vocab'] || '').toLowerCase().includes('hydra')))
    return { kind: hydra ? 'hydra' : 'json-ld', meta: ctx }
  }

  // HAL
  if (obj._links && typeof obj._links === 'object') {
    return { kind: 'hal', meta: Object.keys(obj._links).slice(0, 3).join(', ') }
  }

  return null
}

// Array stats from JSON: path + length + 1-2 sample items
export function collectArrayStats(root, path = '$', out = []) {
  if (!root || typeof root !== 'object') return out
  if (Array.isArray(root)) {
    out.push({
      path,
      length: root.length,
      sample: root.slice(0, 2)
    })
    root.forEach((v, i) => collectArrayStats(v, `${path}[${i}]`, out))
  } else {
    for (const [k, v] of Object.entries(root)) {
      const p = `${path}.${k}`
      if (v && typeof v === 'object') {
        collectArrayStats(v, p, out)
      }
    }
  }
  return out
}

// Traverse JSON, yield all string values that look like URLs
export function* jsonStringUrls(root) {
  const stack = [{ v: root, p: '$' }]
  while (stack.length) {
    const { v, p } = stack.pop()
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
      yield { url: v, path: p }
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => stack.push({ v: x, p: `${p}[${i}]` }))
    } else if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        stack.push({ v: val, p: `${p}.${k}` })
      }
    }
  }
}
