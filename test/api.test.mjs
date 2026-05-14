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

test('fetchLockState returns slot and team locks from one request', async () => {
  const calls = []
  await withMockedFetch(async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return createJsonResponse({
      slots: [{ teamId: 'team-1', slotIndex: 0, qq: '10001', timestamp: 123 }],
      teams: [{ teamId: 'team-2', timestamp: 456 }],
    })
  }, async () => {
    const { fetchLockState } = await import(`../src/api.ts?case=${Date.now()}-lock-state`)
    const result = await fetchLockState()

    assert.equal(result.slots.length, 1)
    assert.equal(result.slots[0].qq, '10001')
    assert.equal(result.teams.length, 1)
    assert.equal(result.teams[0].teamId, 'team-2')
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].input, '/api/locks')
})

test('backup API helpers use the backup endpoints', async () => {
  const calls = []
  await withMockedFetch(async (input, init = {}) => {
    calls.push({ input: String(input), init })
    if (String(input).endsWith('/backups/restore')) {
      return createJsonResponse({
        ok: true,
        data: { teams: [], cancellations: [], archivedTeams: [], logs: [] },
      })
    }
    if (String(input).endsWith('/backups/import')) {
      return createJsonResponse({
        ok: true,
        name: 'backup-imported.json.gz',
        data: { teams: [], cancellations: [], archivedTeams: [], logs: [] },
      })
    }
    return createJsonResponse({
      ok: true,
      backups: [{ name: 'backup-2026-01-01T00-00-00-000Z.json.gz', createdAt: '2026-01-01T00:00:00.000Z', size: 12 }],
    })
  }, async () => {
    const mod = await import(`../src/api.ts?case=${Date.now()}-backups`)

    const list = await mod.fetchBackups()
    assert.equal(list.ok, true)
    assert.equal(list.backups[0].name, 'backup-2026-01-01T00-00-00-000Z.json.gz')

    const created = await mod.createBackup()
    assert.equal(created.ok, true)

    const restored = await mod.restoreBackup('backup-2026-01-01T00-00-00-000Z.json.gz')
    assert.equal(restored.ok, true)

    const deleted = await mod.deleteBackup('backup-2026-01-01T00-00-00-000Z.json.gz')
    assert.equal(deleted.ok, true)

    const file = {
      arrayBuffer: async () => Buffer.from('backup').buffer,
    }
    const imported = await mod.importBackupFile(file)
    assert.equal(imported.ok, true)
    assert.equal(imported.name, 'backup-imported.json.gz')
  })

  assert.equal(calls[0].input, '/api/backups')
  assert.equal(calls[1].init.method, 'POST')
  assert.equal(calls[2].input, '/api/backups/restore')
  assert.equal(calls[3].input, '/api/backups')
  assert.equal(calls[3].init.method, 'DELETE')
  assert.equal(calls[4].input, '/api/backups/import')
  assert.equal(calls[4].init.headers['Content-Type'], 'application/octet-stream')
})

test('subsidy preset API helpers use the preset endpoints', async () => {
  const calls = []
  await withMockedFetch(async (input, init = {}) => {
    calls.push({ input: String(input), init })
    if (init.method === 'POST') return createJsonResponse({ ok: true })
    return createJsonResponse({
      ok: true,
      presets: [{ id: 'preset-damage', name: '伤害补贴', levels: [{ name: '第一', gold: 8000 }] }],
    })
  }, async () => {
    const mod = await import(`../src/api.ts?case=${Date.now()}-subsidy-presets`)

    const presets = await mod.fetchSubsidyPresets()
    assert.equal(presets[0].name, '伤害补贴')

    const pushed = await mod.pushSubsidyPresets(presets)
    assert.equal(pushed, true)
  })

  assert.equal(calls[0].input, '/api/subsidy-presets')
  assert.equal(calls[1].input, '/api/subsidy-presets')
  assert.equal(calls[1].init.method, 'POST')
})
