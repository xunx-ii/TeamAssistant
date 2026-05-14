export function createReadCache(ttlMs, loader, now = () => Date.now()) {
  let cached = null
  let pending = null

  return async () => {
    const currentTime = now()
    if (cached && currentTime - cached.timestamp <= ttlMs) {
      return cached.value
    }
    if (pending) return pending

    pending = Promise.resolve(loader())
      .then(value => {
        cached = { timestamp: now(), value }
        return value
      })
      .finally(() => {
        pending = null
      })

    return pending
  }
}
