import test from 'node:test'
import assert from 'node:assert/strict'

function createJsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function createHtmlResponse(body = '<!doctype html><html><body>index</body></html>', init = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    ...init,
  })
}

async function withMockedFetch(mock, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mock
  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('checkServer returns false when /api/data responds with html', async () => {
  await withMockedFetch(async () => createHtmlResponse(), async () => {
    const { checkServer } = await import(`../src/api.ts?case=${Date.now()}-html-check`)
    const ok = await checkServer()
    assert.equal(ok, false)
  })
})

test('mutateData returns explicit message when backend is unreachable', async () => {
  await withMockedFetch(async () => {
    throw new TypeError('fetch failed')
  }, async () => {
    const { mutateData } = await import(`../src/api.ts?case=${Date.now()}-network`)
    const result = await mutateData({ type: 'renameTeam', teamId: 'team-1', name: '一团' })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'network')
    assert.equal(result.error, '无法连接到报名服务，请确认后端已启动')
  })
})

test('mutateData reports html fallback response instead of generic network error', async () => {
  await withMockedFetch(async () => createHtmlResponse(), async () => {
    const { mutateData } = await import(`../src/api.ts?case=${Date.now()}-html`)
    const result = await mutateData({ type: 'renameTeam', teamId: 'team-1', name: '一团' })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'invalidResponse')
    assert.equal(result.error, '接口返回了页面内容，请确认后端已启动，或已为开发环境配置 /api 代理')
  })
})

test('acquireSlotLock preserves server conflict payload', async () => {
  await withMockedFetch(async () => createJsonResponse({
    ok: false,
    lockedBy: '10001',
    lockedAt: 123456,
  }), async () => {
    const { acquireSlotLock } = await import(`../src/api.ts?case=${Date.now()}-lock`)
    const result = await acquireSlotLock('team-1', 0, '10002')
    assert.equal(result.ok, false)
    assert.equal(result.lockedBy, '10001')
    assert.equal(result.lockedAt, 123456)
  })
})

test('validateLock returns explicit network reason when request fails', async () => {
  await withMockedFetch(async () => {
    throw new TypeError('fetch failed')
  }, async () => {
    const { validateLock } = await import(`../src/api.ts?case=${Date.now()}-validate`)
    const result = await validateLock('team-1', 0, '10001', 123456)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'network')
    assert.equal(result.error, '无法连接到报名服务，请确认后端已启动')
  })
})
