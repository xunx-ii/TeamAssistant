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
  assert.equal(calls.writeData, 1)
  assert.equal(validateSnapshotData(nextData), true)
})

test('runtime lock mutations preserve locks acquired while data is persisting', async () => {
  const { store } = createStore()
  let releaseWriteData
  const originalWriteData = store.writeData
  store.writeData = async (nextData) => {
    await new Promise(resolve => { releaseWriteData = resolve })
    await originalWriteData(nextData)
  }
  const runtime = createRuntime(store)
  await runtime.init()

  const mutationPromise = runtime.mutate({
    type: 'setTeamLockState',
    teamId: 'team-1',
    locked: true,
  })
  await Promise.resolve()

  const lock = runtime.acquireLock({ teamId: 'team-2', slotIndex: 3, qq: '20002' })
  assert.equal(lock.ok, true)

  releaseWriteData()
  await mutationPromise

  const publicLocks = runtime.getPublicLocks()
  assert.equal(publicLocks.teams.some(item => item.teamId === 'team-1'), true)
  assert.equal(publicLocks.slots.some(item => (
    item.teamId === 'team-2' &&
    item.slotIndex === 3 &&
    item.qq === '20002'
  )), true)
})
