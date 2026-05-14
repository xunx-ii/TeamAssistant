import test from 'node:test'
import assert from 'node:assert/strict'

import { startAdaptivePoll } from '../src/polling.ts'

function createTimerEnv() {
  let id = 0
  const timers = []
  return {
    timers,
    install() {
      const originalWindow = globalThis.window
      const originalDocument = globalThis.document
      globalThis.window = {
        setTimeout(callback, delay) {
          const timer = { id: ++id, callback, delay, cleared: false }
          timers.push(timer)
          return timer.id
        },
        clearTimeout(timerId) {
          const timer = timers.find(item => item.id === timerId)
          if (timer) timer.cleared = true
        },
      }
      globalThis.document = { visibilityState: 'visible' }
      return () => {
        globalThis.window = originalWindow
        globalThis.document = originalDocument
      }
    },
    async runNext() {
      const timer = timers.find(item => !item.cleared && !item.ran)
      assert.ok(timer, 'expected a scheduled timer')
      timer.ran = true
      await timer.callback()
      await Promise.resolve()
      return timer
    },
  }
}

test('startAdaptivePoll waits for each task before scheduling the next run', async () => {
  const env = createTimerEnv()
  const restore = env.install()
  let finishFirst
  let activeTasks = 0
  let maxActiveTasks = 0
  let calls = 0

  try {
    const controller = startAdaptivePoll(() => {
      calls += 1
      activeTasks += 1
      maxActiveTasks = Math.max(maxActiveTasks, activeTasks)
      return new Promise(resolve => {
        finishFirst = () => {
          activeTasks -= 1
          resolve(true)
        }
      })
    }, { baseDelayMs: 100 })

    const firstRun = env.runNext()
    await Promise.resolve()
    assert.equal(calls, 1)
    assert.equal(env.timers.filter(timer => !timer.cleared && !timer.ran).length, 0)

    finishFirst()
    await firstRun
    assert.equal(maxActiveTasks, 1)
    assert.equal(env.timers.find(timer => !timer.cleared && !timer.ran)?.delay, 100)

    controller.stop()
  } finally {
    restore()
  }
})

test('startAdaptivePoll backs off after failed tasks', async () => {
  const env = createTimerEnv()
  const restore = env.install()
  try {
    startAdaptivePoll(async () => false, {
      baseDelayMs: 100,
      maxDelayMs: 1_000,
    })

    await env.runNext()
    assert.equal(env.timers.find(timer => !timer.cleared && !timer.ran)?.delay, 200)
  } finally {
    restore()
  }
})
