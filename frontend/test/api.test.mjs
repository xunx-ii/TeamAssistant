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

function createBlobResponse(body = 'backup', init = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': 'attachment; filename="backup.json.gz"',
    },
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

test('checkServer returns false when /api/v2/version responds with html', async () => {
  await withMockedFetch(async () => createHtmlResponse(), async () => {
    const { checkServer } = await import(`../src/api.ts?case=${Date.now()}-html-check`)
    const ok = await checkServer()
    assert.equal(ok, false)
  })
})

test('checkServer falls back to direct backend when dev proxy returns html', async () => {
  const calls = []
  await withMockedFetch(async input => {
    calls.push(String(input))
    if (calls.length === 1) return createHtmlResponse()
    return createJsonResponse({ ok: true, dataVersion: 1, lockVersion: 1 })
  }, async () => {
    const { checkServer } = await import(`../src/api.ts?case=${Date.now()}-html-fallback-check`)
    const ok = await checkServer()
    assert.equal(ok, true)
  })

  assert.equal(calls[0], '/api/v2/version')
  assert.match(calls[1], /^http:\/\/127\.0\.0\.1:23219\/api\/v2\/version$/)
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
  await withMockedFetch(async input => {
    assert.match(String(input), /\/api\/v2\/teams\/team-1$/)
    return createHtmlResponse()
  }, async () => {
    const { mutateData } = await import(`../src/api.ts?case=${Date.now()}-html`)
    const result = await mutateData({ type: 'renameTeam', teamId: 'team-1', name: '一团' })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'invalidResponse')
    assert.equal(result.error, '接口返回了页面内容，请确认后端已启动，或已为开发环境配置 /api/v2 代理')
  })
})

test('mutateData falls back to direct backend when proxy returns html', async () => {
  const calls = []
  await withMockedFetch(async input => {
    calls.push(String(input))
    if (calls.length === 1) return createHtmlResponse()
    return createJsonResponse({ ok: true, dataVersion: 2, lockVersion: 3, patch: { type: 'renameTeam' } })
  }, async () => {
    const { mutateData } = await import(`../src/api.ts?case=${Date.now()}-html-mutate-fallback`)
    const result = await mutateData({ type: 'renameTeam', teamId: 'team-1', name: '一团' })
    assert.equal(result.ok, true)
    assert.equal(result.dataVersion, 2)
  })

  assert.equal(calls[0], '/api/v2/teams/team-1')
  assert.match(calls[1], /^http:\/\/127\.0\.0\.1:23219\/api\/v2\/teams\/team-1$/)
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

test('checkServer uses the lightweight version endpoint', async () => {
  const calls = []
  await withMockedFetch(async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return createJsonResponse({ ok: true, dataVersion: 1, lockVersion: 1 })
  }, async () => {
    const { checkServer } = await import(`../src/api.ts?case=${Date.now()}-version-check`)
    assert.equal(await checkServer(), true)
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].input, '/api/v2/version')
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
    assert.equal(result.lockVersion, undefined)
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].input, '/api/v2/locks')
})

test('fetchLockState preserves lock version when provided', async () => {
  await withMockedFetch(async () => createJsonResponse({
    slots: [],
    teams: [],
    lockVersion: 9,
  }), async () => {
    const { fetchLockState } = await import(`../src/api.ts?case=${Date.now()}-lock-version`)
    const result = await fetchLockState()

    assert.equal(result.lockVersion, 9)
  })
})

test('fetchServerVersion reads the lightweight version endpoint', async () => {
  const calls = []
  await withMockedFetch(async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return createJsonResponse({
      ok: true,
      dataVersion: 3,
      lockVersion: 7,
    })
  }, async () => {
    const { fetchServerVersion } = await import(`../src/api.ts?case=${Date.now()}-version`)
    const result = await fetchServerVersion()
    assert.equal(result.dataVersion, 3)
    assert.equal(result.lockVersion, 7)
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].input, '/api/v2/version')
})

test('fetchServerChanges requests only version deltas and parses changed payloads', async () => {
  const calls = []
  await withMockedFetch(async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return createJsonResponse({
      ok: true,
      dataVersion: 4,
      lockVersion: 8,
      dataChanged: false,
      lockChanged: true,
      locks: {
        slots: [{ teamId: 'team-1', slotIndex: 0, qq: '10001', timestamp: 123 }],
        teams: [],
        lockVersion: 8,
      },
    })
  }, async () => {
    const { fetchServerChanges } = await import(`../src/api.ts?case=${Date.now()}-changes`)
    const result = await fetchServerChanges(3, 7)

    assert.equal(result.dataChanged, false)
    assert.equal(result.lockChanged, true)
    assert.equal(result.locks.slots[0].qq, '10001')
    assert.equal(result.locks.lockVersion, 8)
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].input, '/api/v2/sync?dataVersion=3&lockVersion=7')
})

test('subscribeServerEvents parses server sent version events', async () => {
  const originalEventSource = globalThis.EventSource
  const instances = []
  class MockEventSource {
    constructor(url) {
      this.url = url
      this.listeners = {}
      this.closed = false
      instances.push(this)
    }
    addEventListener(type, listener) {
      this.listeners[type] = listener
    }
    close() {
      this.closed = true
    }
    emit(type, data) {
      this.listeners[type]?.({ data: JSON.stringify(data) })
    }
  }
  globalThis.EventSource = MockEventSource
  try {
    const events = []
    const { subscribeServerEvents } = await import(`../src/api.ts?case=${Date.now()}-events`)
    const unsubscribe = subscribeServerEvents(event => events.push(event))

    assert.equal(instances[0].url, '/api/v2/events')
    instances[0].emit('version', { ok: true, type: 'data', dataVersion: 5, lockVersion: 9 })
    assert.equal(events.length, 1)
    assert.equal(events[0].dataVersion, 5)
    assert.equal(events[0].lockVersion, 9)

    unsubscribe()
    assert.equal(instances[0].closed, true)
  } finally {
    globalThis.EventSource = originalEventSource
  }
})

test('backup API helpers use the backup endpoints', async () => {
  const calls = []
  await withMockedFetch(async (input, init = {}) => {
    calls.push({ input: String(input), init })
    if (String(input).endsWith('/restore')) {
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
    if (String(input).endsWith('/download')) {
      return createBlobResponse()
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

    const downloaded = await mod.downloadBackup('backup-2026-01-01T00-00-00-000Z.json.gz')
    assert.equal(downloaded.ok, true)
    assert.equal(downloaded.filename, 'backup.json.gz')
    assert.equal(await downloaded.blob.text(), 'backup')

    const deleted = await mod.deleteBackup('backup-2026-01-01T00-00-00-000Z.json.gz')
    assert.equal(deleted.ok, true)

    const file = {
      arrayBuffer: async () => Buffer.from('backup').buffer,
    }
    const imported = await mod.importBackupFile(file)
    assert.equal(imported.ok, true)
    assert.equal(imported.name, 'backup-imported.json.gz')
  })

  assert.equal(calls[0].input, '/api/v2/backups')
  assert.equal(calls[1].init.method, 'POST')
  assert.equal(calls[2].input, '/api/v2/backups/backup-2026-01-01T00-00-00-000Z.json.gz/restore')
  assert.equal(calls[3].input, '/api/v2/backups/backup-2026-01-01T00-00-00-000Z.json.gz/download')
  assert.equal(calls[4].input, '/api/v2/backups/backup-2026-01-01T00-00-00-000Z.json.gz')
  assert.equal(calls[4].init.method, 'DELETE')
  assert.equal(calls[5].input, '/api/v2/backups/import')
  assert.equal(calls[5].init.headers['Content-Type'], 'application/octet-stream')
})

test('downloadBackup falls back to direct backend when proxy returns html', async () => {
  const calls = []
  await withMockedFetch(async input => {
    calls.push(String(input))
    if (calls.length === 1) return createHtmlResponse()
    return createBlobResponse('direct-backup', {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': 'attachment; filename="direct.json.gz"',
      },
    })
  }, async () => {
    const { downloadBackup } = await import(`../src/api.ts?case=${Date.now()}-download-fallback`)
    const result = await downloadBackup('backup-1.json.gz')
    assert.equal(result.ok, true)
    assert.equal(result.filename, 'direct.json.gz')
    assert.equal(await result.blob.text(), 'direct-backup')
  })

  assert.equal(calls[0], '/api/v2/backups/backup-1.json.gz/download')
  assert.match(calls[1], /^http:\/\/127\.0\.0\.1:23219\/api\/v2\/backups\/backup-1\.json\.gz\/download$/)
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

  assert.equal(calls[0].input, '/api/v2/subsidy-presets')
  assert.equal(calls[1].input, '/api/v2/subsidy-presets')
  assert.equal(calls[1].init.method, 'PUT')
})

test('mutateData routes slot signup to atomic v2 member endpoint', async () => {
  const calls = []
  await withMockedFetch(async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return createJsonResponse({ ok: true, dataVersion: 2, lockVersion: 3, patch: { type: 'signupSlot' } })
  }, async () => {
    const { mutateData } = await import(`../src/api.ts?case=${Date.now()}-atomic-signup`)
    const result = await mutateData({
      type: 'signupSlot',
      teamId: 'team-1',
      slotIndex: 4,
      actorQq: '10001',
      lockTimestamp: 123456,
      expectedMemberQq: null,
      member: {
        qq: '10001',
        martialArtIndex: '1',
        gearScore: '1200',
        characterId: '角色A',
        note: '',
      },
    })

    assert.equal(result.ok, true)
    assert.equal(calls[0].input, '/api/v2/teams/team-1/slots/4/member')
    assert.equal(calls[0].init.method, 'PUT')
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      qq: '10001',
      actorQq: '10001',
      member: {
        qq: '10001',
        martialArtIndex: '1',
        gearScore: '1200',
        characterId: '角色A',
        note: '',
      },
      lockToken: 123456,
      expectedMemberQq: null,
    })
  })
})
