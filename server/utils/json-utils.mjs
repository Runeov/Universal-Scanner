export function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    const v = k.includes('.') ? k.split('.').reduce((o, p) => (o ? o[p] : undefined), obj) : obj[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}
export function inferRoot(json) {
  if (json && typeof json === 'object' && Array.isArray(json.data)) return { root: json.data, path: 'data' };
  if (Array.isArray(json)) return { root: json, path: '$' };
  if (json && typeof json === 'object' && json.data && typeof json.data === 'object') return { root: [json.data], path: 'data(object)' };
  return { root: null, path: null };
}
