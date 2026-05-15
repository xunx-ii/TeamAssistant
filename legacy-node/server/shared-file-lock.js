import { open, stat, unlink, utimes } from 'fs/promises'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function isStale(lockFile, staleMs) {
  try {
    const info = await stat(lockFile)
    return Date.now() - info.mtimeMs > staleMs
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function createLockPayload() {
  return JSON.stringify({
    pid: process.pid,
    timestamp: Date.now(),
  })
}

function startHeartbeat(lockFile, staleMs) {
  const intervalMs = Math.max(10, Math.floor(staleMs / 3))
  const interval = setInterval(() => {
    const now = new Date()
    void utimes(lockFile, now, now).catch(() => {
      // The lock may have been removed while the holder is exiting.
    })
  }, intervalMs)
  interval.unref?.()
  return () => clearInterval(interval)
}

export async function withFileLock(lockFile, callback, options = {}) {
  const {
    retryMs = 25,
    staleMs = 15_000,
    timeoutMs = 10_000,
  } = options

  const startedAt = Date.now()

  while (true) {
    let handle

    try {
      handle = await open(lockFile, 'wx')
      await handle.writeFile(createLockPayload())
      const stopHeartbeat = startHeartbeat(lockFile, staleMs)
      try {
        return await callback()
      } finally {
        stopHeartbeat()
        await handle.close()
        try {
          await unlink(lockFile)
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
            throw error
          }
        }
      }
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
        throw error
      }

      if (await isStale(lockFile, staleMs)) {
        try {
          await unlink(lockFile)
        } catch (unlinkError) {
          if (!(unlinkError && typeof unlinkError === 'object' && 'code' in unlinkError && unlinkError.code === 'ENOENT')) {
            throw unlinkError
          }
        }
        continue
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out acquiring file lock: ${lockFile}`)
      }

      await sleep(retryMs)
    }
  }
}
