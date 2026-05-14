import test from 'node:test'
import assert from 'node:assert/strict'

import { createRuntimeState } from '../server/runtime-state.js'
import { normalizeData, validateSnapshotData } from '../server/data-store.js'
import { normalizeLockData } from '../server/lock-store.js'

function createSnapshot() {
  return {
    teams: [
      {
        id: 'team-1',
        name: '一团',
        note: '',
        config: { reservedSlots: [], locked: false },
        slots: Array.from({ length: 25 }, (_, index) => ({
          index,
          status: 'empty',
          member: null,
          fixedRole: null,
          fixedMartialArtIndex: null,
        })),
      },
    ],
    cancellations: [],
    archivedTeams: [],
    logs: [],
    userProfiles: {},
  }
}

function createStore() {
  const calls = {
    readData: 0,
    writeData: 0,
    readLocks: 0,
    writeLocks: 0,
    readSubsidyPresets: 0,
    writeSubsidyPresets: 0,
    backupNow: 0,
  }
  let data = createSnapshot()
  let locks = { slots: [], teams: [] }
  let subsidyPresets = []

  return {
    calls,
    store: {
      async readData() {
        calls.readData += 1
        return structuredClone(data)
      },
      async writeData(nextData) {
        calls.writeData += 1
        data = normalizeData(nextData)
      },
      async readLocks() {
        calls.readLocks += 1
        return structuredClone(locks)
      },
      async writeLocks(nextLocks) {
        calls.writeLocks += 1
        locks = normalizeLockData(nextLocks)
      },
      async readSubsidyPresets() {
        calls.readSubsidyPresets += 1
        return structuredClone(subsidyPresets)
      },
      async writeSubsidyPresets(nextPresets) {
        calls.writeSubsidyPresets += 1
        subsidyPresets = structuredClone(nextPresets)
      },
      async backupNow() {
        calls.backupNow += 1
        return `backup-${calls.backupNow}.json.gz`
      },
      getData() {
        return structuredClone(data)
      },
    },
  }
}

function createRuntime(store) {
  return createRuntimeState({
    store,
    normalizeSubsidyPresets: value => Array.isArray(value) ? value : [],
    isAdminQq: qq => qq === 'admin',
    lockTimeout: 30_000,
  })
}

test('runtime state serves public reads from memory after init', async () => {
  const { store, calls } = createStore()
  const runtime = createRuntime(store)
  await runtime.init()

  assert.equal(calls.readData, 1)
  assert.equal(calls.readLocks, 1)
  assert.equal(calls.readSubsidyPresets, 1)

  const first = runtime.getPublicData()
  const second = runtime.getPublicData()
  assert.equal(first.teams[0].id, 'team-1')
  assert.equal(second.teams[0].id, 'team-1')
  assert.equal(calls.readData, 1)
  assert.equal(calls.readLocks, 1)
})

test('runtime lock operations update memory before debounced persistence', async () => {
  const { store, calls } = createStore()
  const runtime = createRuntime(store)
  await runtime.init()

  const acquired = runtime.acquireLock({ teamId: 'team-1', slotIndex: 0, qq: '10001' })
  assert.equal(acquired.ok, true)
  assert.equal(runtime.getPublicLocks().slots.length, 1)
  assert.equal(calls.readLocks, 1)

  await runtime.flushLocks()
  assert.equal(calls.writeLocks, 1)
})

test('runtime mutate validates lock, updates version, and persists data once', async () => {
  const { store, calls } = createStore()
  const runtime = createRuntime(store)
  await runtime.init()
  const lock = runtime.acquireLock({ teamId: 'team-1', slotIndex: 0, qq: '10001' })
  const before = runtime.getVersion()

  const nextData = await runtime.mutate({
    type: 'signupSlot',
    teamId: 'team-1',
    slotIndex: 0,
    member: {
      qq: '10001',
      martialArtIndex: '4',
      gearScore: '8',
      characterId: '角色A',
      note: '',
    },
    actorQq: '10001',
    lockTimestamp: lock.timestamp,
    expectedMemberQq: null,
  })

  assert.equal(nextData.teams[0].slots[0].member.characterId, '角色A')
  assert.equal(runtime.getVersion().dataVersion, before.dataVersion + 1)
  assert.equal(calls.writeData, 0)
  assert.equal(validateSnapshotData(nextData), true)

  await runtime.flushData()
  assert.equal(calls.writeData, 1)
})

test('runtime throttles repeated snapshot writes and flushes the latest state', async () => {
  const { store, calls } = createStore()
  const runtime = createRuntime(store)
  await runtime.init()

  await runtime.mutate({
    type: 'renameTeam',
    teamId: 'team-1',
    name: '一团改名',
  })
  await runtime.mutate({
    type: 'updateTeamNote',
    teamId: 'team-1',
    note: '节流写入',
  })

  assert.equal(calls.writeData, 0)
  assert.equal(runtime.getPublicData().teams[0].name, '一团改名')
  assert.equal(runtime.getPublicData().teams[0].note, '节流写入')

  await runtime.flushData()
  assert.equal(calls.writeData, 1)
  assert.equal(store.getData().teams[0].name, '一团改名')
  assert.equal(store.getData().teams[0].note, '节流写入')
})

test('runtime lock changes use in-memory state and incremental versions', async () => {
  const { store, calls } = createStore()
  const runtime = createRuntime(store)
  await runtime.init()
  const before = runtime.getVersion()

  const lock = runtime.acquireLock({ teamId: 'team-2', slotIndex: 3, qq: '20002' })
  assert.equal(lock.ok, true)
  assert.equal(calls.readLocks, 1)
  assert.equal(calls.writeLocks, 0)

  const changes = runtime.getChanges(before)
  assert.equal(changes.dataChanged, false)
  assert.equal(changes.lockChanged, true)
  assert.equal(changes.locks.slots[0].qq, '20002')

  await runtime.flushLocks()
  assert.equal(calls.writeLocks, 1)
})

test('runtime subscriptions receive version changes', async () => {
  const { store } = createStore()
  const runtime = createRuntime(store)
  await runtime.init()
  const events = []
  const unsubscribe = runtime.subscribe(event => events.push(event))

  runtime.acquireLock({ teamId: 'team-1', slotIndex: 0, qq: '10001' })
  await runtime.mutate({
    type: 'renameTeam',
    teamId: 'team-1',
    name: '事件团',
  })
  unsubscribe()
  runtime.acquireLock({ teamId: 'team-1', slotIndex: 1, qq: '10002' })

  assert.equal(events.length, 2)
  assert.equal(events[0].type, 'locks')
  assert.equal(events[1].type, 'data')
  assert.equal(events[1].dataVersion, runtime.getVersion().dataVersion)
})
