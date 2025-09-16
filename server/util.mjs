export const urlRegex = /https?:\/\/[\w.-]+(?:\:[0-9]+)?(?:\/[\w\-._~!$&'()*+,;=:@%/?#]*)?/gi

export function absolute(base, href) {
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

export function sameOrigin(u1, u2) {
  try {
    const a = new URL(u1)
    const b = new URL(u2)
    return a.origin === b.origin
  } catch {
    return false
  }
}

export function clipMiddle(text, max = 20) {
  if (!text || text.length <= max) return text
  const head = Math.ceil((max - 1) * 0.6)
  const tail = (max - 1) - head
  return text.slice(0, head) + '…' + text.slice(-tail)
}
