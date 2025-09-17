export function classifyRequest(req, resInfo) {
  const url = req.url()
  const method = req.method()
  const rtype = req.resourceType()
  const ct = (resInfo?.headers?.['content-type'] || resInfo?.headers?.['Content-Type'] || '').toLowerCase()
  let path = ''
  try { path = new URL(url).pathname } catch {}
  const isApiPath = /\b(api|graphql|gql|search|results|availability|gateway|v\d+)\b/i.test(path)
  return {
    apiCandidate: Boolean(ct.includes('json') || /\+json/.test(ct) || rtype === 'xhr' || rtype === 'fetch' || isApiPath),
    isJson: ct.includes('json') || /\+json/.test(ct),
    isGraphQL: /graphql|gql/i.test(url) || (method === 'POST' && /application\/(json|graphql)/i.test(req.headers()['content-type'] || '')),
    isXhrFetch: rtype === 'xhr' || rtype === 'fetch',
    isApiLikePath: isApiPath,
    contentType: ct,
  }
}