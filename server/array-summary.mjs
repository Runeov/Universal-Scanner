// server/array-summary.mjs

function isIsoDateLike(s) {
  return (
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}(?:[Tt ][0-9:\.]+(?:Z|[+\-][0-9:]+)?)?$/.test(s)
  )
}

function detectType(v) {
  if (v === null) return 'null'
  const t = typeof v
  if (t !== 'object') return t // string | number | boolean | undefined | function | symbol | bigint
  if (Array.isArray(v)) return 'array'
  return 'object'
}

function ensure(obj, k, def) {
  // eslint-disable-next-line no-prototype-builtins
  if (!obj || !obj.hasOwnProperty(k)) obj[k] = def
  return obj[k]
}

// Flatten only ONE level of nested objects: { location: { city } } -> { "location.city": ... }
// Arrays at a property are not flattened (they are summarized separately as arrays elsewhere).
function* flattenLevel1(record) {
  for (const [k, v] of Object.entries(record || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        yield [`${k}.${k2}`, v2]
      }
    } else {
      yield [k, v]
    }
  }
}

function summarizeFieldStatsOverItems(items, maxUnique = 500) {
  // fieldStats: key -> { present, nullish, types: {type->count}, numeric: {min,max,sum}, examples:[], unique: number|null, hasDateLike: boolean }
  const fieldStats = {}
  for (const it of items) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue
    // first-level fields + 1-level flatten of nested objects
    for (const [k, v] of flattenLevel1(it)) {
      const fs = ensure(fieldStats, k, {
        present: 0,
        nullish: 0,
        types: {},
        numeric: null, // {min,max,sum}
        examples: [],
        _uniqueSet: undefined,
        unique: null,
        hasDateLike: false
      })

      if (v === null || v === undefined) {
        fs.nullish++
      } else {
        fs.present++
        const t = detectType(v)
        fs.types[t] = (fs.types[t] || 0) + 1
        if (t === 'number') {
          if (!fs.numeric) fs.numeric = { min: v, max: v, sum: 0 }
          if (v < fs.numeric.min) fs.numeric.min = v
          if (v > fs.numeric.max) fs.numeric.max = v
          fs.numeric.sum += v
        }
        if (t === 'string' && isIsoDateLike(v)) fs.hasDateLike = true
        if (fs.examples.length < 3) fs.examples.push(v)
        // unique tracking (approximate; cap set size)
        if (t === 'string' || t === 'number') {
          if (!fs._uniqueSet) fs._uniqueSet = new Set()
          if (fs._uniqueSet.size <= maxUnique) fs._uniqueSet.add(String(v))
        }
      }
    }
  }
  // finalize unique counts
  for (const fs of Object.values(fieldStats)) {
    if (fs._uniqueSet) fs.unique = fs._uniqueSet.size
    delete fs._uniqueSet
  }
  return fieldStats
}

function summarizeObjectFields(items, maxExamples = 3) {
  // Backwards-compatible quick schema & likely id fields (used by old UI)
  const keys = new Set()
  for (const it of items) {
    if (it && typeof it === 'object' && !Array.isArray(it)) {
      Object.keys(it).forEach((k) => keys.add(k))
    }
  }
  const schema = {}
  const keyValues = {}
  for (const k of keys) {
    const typeSet = {}
    const examples = []
    for (const it of items) {
      const v = it?.[k]
      const t = detectType(v)
      typeSet[t] = (typeSet[t] || 0) + 1
      if (examples.length < maxExamples && v !== undefined) examples.push(v)
      if (!keyValues[k]) keyValues[k] = new Set()
      if (v !== undefined && (typeof v === 'string' || typeof v === 'number')) {
        keyValues[k].add(String(v))
      }
    }
    schema[k] = { types: Object.keys(typeSet), examples }
  }
  const uniqueKeys = Object.entries(keyValues)
    .filter(([k, set]) => set.size === items.length && items.length > 0)
    .map(([k]) => k)
  const boosted =
    uniqueKeys.length > 0
      ? uniqueKeys
      : Array.from(keys).filter((k) => /(^id$|_id$|uuid|slug)/i.test(k))
  return { schema, uniqueKeys: boosted }
}

function jsonPath(parentPath, key) {
  if (typeof key === 'number') return `${parentPath}[${key}]`
  if (parentPath === '$') return `$.${key}`
  return `${parentPath}.${key}`
}

export function summarizeArraysFromJson(
  root,
  { minArrayLength = 1, maxItemsToSample = 10, maxArrays = 200, maxScanItems = 200 } = {}
) {
  const out = []
  const stack = [{ v: root, p: '$' }]
  while (stack.length && out.length < maxArrays) {
    const { v, p } = stack.pop()
    if (Array.isArray(v)) {
      const len = v.length
      if (len >= minArrayLength) {
        const sample = v.slice(0, Math.min(len, maxItemsToSample))
        let columns = []
        let objectSummary = null

        const scanN = Math.min(len, maxScanItems)
        const scanSlice = v.slice(0, scanN)
        let fieldStats = null

        if (sample.some((x) => x && typeof x === 'object' && !Array.isArray(x))) {
          const colSet = new Set()
          for (const it of sample) {
            if (it && typeof it === 'object' && !Array.isArray(it)) {
              Object.keys(it).forEach((k) => colSet.add(k))
            }
          }
          columns = Array.from(colSet).slice(0, 48)
          objectSummary = summarizeObjectFields(sample, 3)
          fieldStats = summarizeFieldStatsOverItems(scanSlice)
        }

        out.push({
          path: p,
          length: len,
          scanned: scanN,            // NEW: how many items were scanned for stats
          columns,
          schema: objectSummary?.schema || null,
          uniqueKeys: objectSummary?.uniqueKeys || [],
          sample,
          fieldStats                 // NEW: per-field counts/types/numeric/date-like/examples/unique
        })
      }
      // walk nested to find deeper arrays
      v.forEach((child, i) => stack.push({ v: child, p: jsonPath(p, i) }))
    } else if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        stack.push({ v: child, p: jsonPath(p, k) })
      }
    }
  }
  return out
}
