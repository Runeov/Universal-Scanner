// Build image provenance index: imageUrl -> Set(sources)
export function createProvenance() {
  const map = new Map()
  return {
    add(imageUrl, source) {
      if (!imageUrl) return
      if (!map.has(imageUrl)) map.set(imageUrl, new Set())
      map.get(imageUrl).add(source)
    },
    toArray() {
      return Array.from(map.entries()).map(([imageUrl, sources]) => ({
        imageUrl, sources: Array.from(sources)
      }))
    }
  }
}
