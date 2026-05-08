import test from 'node:test'
import assert from 'node:assert/strict'

import { hasHydratableTeams } from '../src/storage.ts'

function createJsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
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

test('loadFromServer reports empty server snapshots without hydrating local data', async () => {
  const storage = installLocalStorage()
  try {
    await withMockedFetch(async () => createJsonResponse({
      teams: [],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    }), async () => {
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
        return createJsonResponse({
          teams: [{ id: 'team-1', name: '一团', note: '', config: { reservedSlots: [], locked: false }, slots: [] }],
          cancellations: [],
          archivedTeams: [],
          logs: [],
        })
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
  try {
    await withMockedFetch(async () => createJsonResponse({
      teams: [{ id: 'team-1', name: '一团 🌸', note: '', config: { reservedSlots: [], locked: false }, slots: [] }],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    }), async () => {
      const mod = await import(`../src/storage.ts?case=${Date.now()}-loaded`)
      assert.equal(await mod.initServerMode(), true)
      assert.equal(await mod.loadFromServer(), 'loaded')
      const storedTeams = JSON.parse(storage.values.get('team_teams_v3'))
      assert.equal(storedTeams[0].slots.length, 25)
      assert.equal(storedTeams[0].config.locked, false)
    })
  } finally {
    storage.restore()
  }
})
