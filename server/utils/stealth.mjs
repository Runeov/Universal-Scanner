export async function applyStealth(ctx) {
  await ctx.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
      window.chrome = window.chrome || { runtime: {} }
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' })
      const orig = navigator.permissions && navigator.permissions.query
      if (orig) {
        navigator.permissions.query = (p) =>
          p && p.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : orig(p)
      }
    } catch {}
  })
}