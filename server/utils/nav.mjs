export async function gotoResilient(page, url, opts = {}) {
  const waits = opts.waits || ['domcontentloaded', 'commit', 'load']
  const timeouts = opts.timeouts || [8000, 8000, 25000]
  let lastErr
  for (let i = 0; i < waits.length; i++) {
    const to = timeouts[i] != null ? timeouts[i] : timeouts[timeouts.length - 1]
    try {
      console.log(`[browser] goto ${url} waitUntil=${waits[i]} timeout=${to}`)
      await page.goto(url, { waitUntil: waits[i], timeout: to })
      return
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}