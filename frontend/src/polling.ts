export interface AdaptivePollOptions {
  baseDelayMs: number
  hiddenDelayMs?: number
  maxDelayMs?: number
  backoffFactor?: number
  runImmediately?: boolean
}

export interface AdaptivePollController {
  stop: () => void
}

export function startAdaptivePoll(
  task: () => Promise<boolean | void>,
  options: AdaptivePollOptions,
): AdaptivePollController {
  const {
    baseDelayMs,
    hiddenDelayMs = Math.max(baseDelayMs, 5_000),
    maxDelayMs = Math.max(hiddenDelayMs, baseDelayMs),
    backoffFactor = 2,
    runImmediately = true,
  } = options
  let stopped = false
  let timeoutId = 0
  let failureCount = 0
  let running = false

  const schedule = (delayMs: number) => {
    if (stopped) return
    window.clearTimeout(timeoutId)
    timeoutId = window.setTimeout(run, Math.max(0, delayMs))
  }

  const getDelay = () => {
    const visibleDelay = Math.min(
      maxDelayMs,
      Math.round(baseDelayMs * (backoffFactor ** failureCount)),
    )
    return document.visibilityState === 'hidden'
      ? Math.max(visibleDelay, hiddenDelayMs)
      : visibleDelay
  }

  const run = async () => {
    if (stopped || running) return
    running = true
    try {
      const ok = await task()
      failureCount = ok === false ? Math.min(failureCount + 1, 6) : 0
    } catch {
      failureCount = Math.min(failureCount + 1, 6)
    } finally {
      running = false
      schedule(getDelay())
    }
  }

  const handleVisibilityChange = () => {
    if (stopped) return
    if (document.visibilityState === 'visible' && !running) {
      // Trigger an immediate sync once the page becomes visible again,
      // so users do not have to wait for the hiddenDelay countdown.
      schedule(0)
    }
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)

  schedule(runImmediately ? 0 : getDelay())

  return {
    stop: () => {
      stopped = true
      window.clearTimeout(timeoutId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    },
  }
}

