import test from 'node:test'
import assert from 'node:assert/strict'

import { hasHydratableTeams } from '../src/storage.ts'

function createJsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createVersionResponse() {
  return createJsonResponse({ ok: true, dataVersion: 1, lockVersion: 1 })
}

function createChangesResponse(data) {
  return createJsonResponse({
    ok: true,
    dataVersion: 1,
    lockVersion: 1,
    dataChanged: true,
    lockChanged: false,
    data,
  })
}

function installLocalStorage() {
  const values = new Map()
  const original = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { values.set(key, String(value)) },
    removeItem: key => { values.delete(key) },
    clear: () => { values.clear() },
  }
  return {
    values,
    restore() {
      if (original) {
        globalThis.localStorage = original
      } else {
        delete globalThis.localStorage
      }
    },
  }
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

test('hasHydratableTeams rejects empty server snapshots', () => {
  assert.equal(hasHydratableTeams(null), false)
  assert.equal(hasHydratableTeams({ teams: [] }), false)
})

test('hasHydratableTeams accepts snapshots with active teams', () => {
  assert.equal(
    hasHydratableTeams({
      teams: [
        {
          id: 'team-1',
          name: '一团',
          note: '',
          config: { reservedSlots: [], locked: false },
          slots: [],
        },
      ],
    }),
    true,
  )
})

test('loadTeams hydrates malformed local storage snapshots', async () => {
  const storage = installLocalStorage()
  try {
    storage.values.set('team_teams_v3', JSON.stringify([{
      id: 'team-legacy',
      name: '旧团',
      slots: [],
    }]))
    const mod = await import(`../src/storage.ts?case=${Date.now()}-local-hydrate`)
    const teams = mod.loadTeams()
    assert.equal(teams.length, 1)
    assert.equal(teams[0].slots.length, 25)
    assert.equal(teams[0].config.locked, false)
  } finally {
    storage.restore()
  }
})

test('initialization uses one full sync with the viewer identity and preserves an empty board', async () => {
  const calls = []
  await withMockedFetch(async (input, init) => {
    calls.push({ input: String(input), init })
    return createChangesResponse({ teams: [], cancellations: [], archivedTeams: [], logs: [], userProfiles: {} })
  }, async () => {
    const mod = await import('../src/storage.ts?case=initial-sync')
    const changes = await mod.initializeServerData('20001')
    assert.deepEqual(changes.data.teams, [])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input, '/api/v2/sync?qq=20001')
    assert.equal(calls[0].init.cache, 'no-store')
    assert.equal(calls[0].init.signal.aborted, false)
  })
})

test('initialization preserves the access gate when the board is protected', async () => {
  const gate = { publicAtMs: Date.now() + 60_000, isOpen: false, authorized: false, requiresInvite: true }
  await withMockedFetch(async () => createChangesResponse({
    teams: [], cancellations: [], accessGate: gate, isAdmin: false,
  }), async () => {
    const mod = await import('../src/storage.ts?case=initial-protected')
    const changes = await mod.initializeServerData('20001')
    assert.equal(changes.data.accessGate.authorized, false)
    assert.equal(changes.data.accessGate.isOpen, false)
    assert.equal(changes.data.accessGate.publicAtMs, gate.publicAtMs)
    assert.equal(await mod.loadFromServer(), 'empty')
  })
})

test('initialization rejects failed or incomplete snapshots', async () => {
  for (const payload of [
    { ok: false, dataVersion: 1, lockVersion: 1, data: { teams: [], cancellations: [] } },
    { ok: true, dataVersion: 1, lockVersion: 1 },
  ]) {
    await withMockedFetch(async () => createJsonResponse(payload), async () => {
      const mod = await import(`../src/storage.ts?case=incomplete-${payload.ok}`)
      assert.equal(await mod.initializeServerData('20001'), null)
      assert.equal(await mod.loadFromServer(), 'unavailable')
    })
  }
})

test('a stalled initialization times out without a direct-backend retry', async t => {
  const mod = await import('../src/storage.ts?case=initial-timeout')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  let requestSignal
  await withMockedFetch(async (_input, { signal }) => {
    calls += 1
    requestSignal = signal
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  }, async () => {
    const pending = mod.initializeServerData('20001')
    t.mock.timers.tick(9_999)
    assert.equal(requestSignal.aborted, false)
    t.mock.timers.tick(1)
    assert.equal(await pending, null)
    assert.equal(requestSignal.aborted, true)
    assert.equal(calls, 1)
    assert.equal(await mod.loadFromServer(), 'unavailable')
  })
})

test('cancelled initialization cannot disable a newer connected session', async () => {
  const storage = installLocalStorage()
  const controller = new AbortController()
  let calls = 0
  try {
    await withMockedFetch(async (_input, { signal }) => {
      calls += 1
      if (calls === 1) return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      return createChangesResponse({
        teams: [{ id: 'team-1', name: '测试团队', slots: [] }], cancellations: [],
      })
    }, async () => {
      const mod = await import('../src/storage.ts?case=cancelled-session')
      const obsolete = mod.initializeServerData('10001', controller.signal)
      assert.ok(await mod.initializeServerData('20001'))
      controller.abort()
      assert.equal(await obsolete, null)
      assert.equal(await mod.loadFromServer(), 'loaded')
      assert.equal(calls, 3)
    })
  } finally {
    storage.restore()
  }
})

test('loadFromServer reports empty server snapshots without hydrating local data', async () => {
  const storage = installLocalStorage()
  let calls = 0
  try {
    await withMockedFetch(async () => {
      calls += 1
      if (calls === 1) return createVersionResponse()
      return createChangesResponse({
        teams: [],
        cancellations: [],
        archivedTeams: [],
        logs: [],
      })
    }, async () => {
      const mod = await import(`../src/storage.ts?case=${Date.now()}-empty`)
      assert.equal(await mod.initServerMode(), true)
      assert.equal(await mod.loadFromServer(), 'empty')
      assert.equal(storage.values.has('team_teams_v3'), false)
    })
  } finally {
    storage.restore()
  }
})

test('loadFromServer reports unavailable when a later fetch fails', async () => {
  const storage = installLocalStorage()
  let calls = 0
  try {
    await withMockedFetch(async () => {
      calls += 1
      if (calls === 1) {
        return createVersionResponse()
      }
      throw new TypeError('fetch failed')
    }, async () => {
      const mod = await import(`../src/storage.ts?case=${Date.now()}-unavailable`)
      assert.equal(await mod.initServerMode(), true)
      assert.equal(await mod.loadFromServer(), 'unavailable')
      assert.equal(storage.values.has('team_teams_v3'), false)
    })
  } finally {
    storage.restore()
  }
})

test('loadFromServer hydrates local data only for active team snapshots', async () => {
  const storage = installLocalStorage()
  let calls = 0
  try {
    await withMockedFetch(async () => {
      calls += 1
      if (calls === 1) return createVersionResponse()
      return createChangesResponse({
        teams: [{ id: 'team-1', name: '一团 🌸', note: '', config: { reservedSlots: [], locked: false }, slots: [] }],
        cancellations: [],
        archivedTeams: [],
        logs: [],
      })
    }, async () => {
      const mod = await import(`../src/storage.ts?case=${Date.now()}-loaded`)
      assert.equal(await mod.initServerMode(), true)
      assert.equal(await mod.loadFromServer(), 'loaded')
      assert.equal(calls, 2)
      const storedTeams = JSON.parse(storage.values.get('team_teams_v3'))
      assert.equal(storedTeams[0].slots.length, 25)
      assert.equal(storedTeams[0].config.locked, false)
    })
  } finally {
    storage.restore()
  }
})
