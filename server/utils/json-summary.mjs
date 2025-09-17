import { pick, inferRoot } from './json-utils.mjs';

export function summarizeJsonGenerically(url, json) {
  const { root, path } = inferRoot(json);
  if (!root || !Array.isArray(root) || root.length === 0) return null;

  let cols;
  if (root.some((x) => x && typeof x === 'object' && !Array.isArray(x))) {
    const set = new Set();
    for (const it of root.slice(0, 10)) if (it && typeof it === 'object' && !Array.isArray(it)) Object.keys(it).forEach((k) => set.add(k));
    cols = Array.from(set).slice(0, 12);
  } else {
    cols = [];
  }

  return {
    kind: 'json',
    path,
    count: root.length,
    columns: cols,
    sample: root.slice(0, 3).map((x) => (cols.length ? pick(x, cols) : x)),
  };
}
