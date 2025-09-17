export async function collectDeepLinks(page, patterns = []) {
  return await page.evaluate((patterns) => {
    const seen = new Set();
    const out = [];
    function collectFrom(root) {
      root.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        try {
          const abs = new URL(href, location.href).toString();
          if (seen.has(abs)) return;
          if (patterns.length && !patterns.some((p) => abs.includes(p))) return;
          seen.add(abs);
          out.push({ href: abs, text: (a.textContent || '').trim(), parent: location.href, parentTitle: document.title || '' });
        } catch {}
      });
      root.querySelectorAll('*').forEach((el) => el.shadowRoot && collectFrom(el.shadowRoot));
    }
    [document].forEach((r) => collectFrom(r));
    return out;
  }, patterns);
}
