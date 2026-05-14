import test from 'node:test'
import assert from 'node:assert/strict'

import { createReadCache } from '../server/read-cache.js'

test('createReadCache shares concurrent reads', async () => {
  let calls = 0
  let release
  const cachedRead = createReadCache(100, () => {
    calls += 1
    return new Promise(resolve => {
      release = () => resolve({ value: calls })
    })
  })

  const first = cachedRead()
  const second = cachedRead()
  assert.equal(calls, 1)

  release()
  assert.deepEqual(await first, { value: 1 })
  assert.deepEqual(await second, { value: 1 })
})

test('createReadCache returns cached value within ttl and refreshes after expiry', async () => {
  let time = 1_000
  let calls = 0
  const cachedRead = createReadCache(100, async () => {
    calls += 1
    return { value: calls }
  }, () => time)

  assert.deepEqual(await cachedRead(), { value: 1 })
  time = 1_050
  assert.deepEqual(await cachedRead(), { value: 1 })
  time = 1_101
  assert.deepEqual(await cachedRead(), { value: 2 })
})
