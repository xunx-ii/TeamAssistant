  import test from 'node:test'
import assert from 'node:assert/strict'

import { applyMutation, validateExpectedSlotMember, validateSlotMutationLock } from '../server/data-store.js'

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
  }
}

test('applyMutation preserves concurrent changes on different slots', () => {
  const base = createSnapshot()
  const first = applyMutation(base, {
    type: 'signupSlot',
    teamId: 'team-1',
    slotIndex: 0,
    member: {
      qq: '10001',
      martialArtIndex: '1',
      gearScore: '1200',
      characterId: 'A',
      note: '',
      hasOrangeWeapon: true,
    },
  })

  const second = applyMutation(first, {
    type: 'signupSlot',
    teamId: 'team-1',
    slotIndex: 1,
    member: {
      qq: '10002',
      martialArtIndex: '4',
      gearScore: '6',
      characterId: 'B',
      note: '',
    },
  })

  assert.equal(second.teams[0].slots[0].member?.qq, '10001')
  assert.equal(second.teams[0].slots[1].member?.qq, '10002')
  assert.equal(second.teams[0].slots[0].member?.hasOrangeWeapon, true)
})

test('validateSlotMutationLock rejects expired slot locks', () => {
  const slotLocks = new Map([
    ['team-1:0', { qq: '10001', timestamp: 1000 }],
  ])
  const teamLocks = new Map()

  const result = validateSlotMutationLock({
    slotLocks,
    teamLocks,
    teamId: 'team-1',
    slotIndex: 0,
    qq: '10001',
    lockTimestamp: 1000,
    lockTimeout: 100,
    now: 1201,
  })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'expired')
})

test('validateExpectedSlotMember rejects stale overwrite', () => {
  const snapshot = createSnapshot()
  snapshot.teams[0].slots[3].status = 'occupied'
  snapshot.teams[0].slots[3].member = {
    qq: '20002',
    martialArtIndex: '8',
    gearScore: '7',
    characterId: 'Current',
    note: '',
  }

  const result = validateExpectedSlotMember(snapshot, 'team-1', 3, '10001')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'slotChanged')
  assert.equal(result.currentMemberQq, '20002')
})

test('cancelSlot appends cancellation and restores reserved status', () => {
  const snapshot = createSnapshot()
  snapshot.teams[0].config.reservedSlots = [2]
  snapshot.teams[0].slots[2] = {
    index: 2,
    status: 'occupied',
    member: {
      qq: '10001',
      martialArtIndex: '0',
      gearScore: '1500',
      characterId: 'Boss',
      note: '',
    },
    fixedRole: null,
    fixedMartialArtIndex: null,
  }

  const next = applyMutation(snapshot, {
    type: 'cancelSlot',
    teamId: 'team-1',
    slotIndex: 2,
    reason: '时间冲突',
    cancelledBy: 'admin',
    timestamp: 123456,
  })

  assert.equal(next.cancellations.length, 1)
  assert.equal(next.cancellations[0].qq, '10001')
  assert.equal(next.teams[0].slots[2].status, 'reserved')
  assert.equal(next.teams[0].slots[2].member, null)
})

test('setTeamLockState updates team config lock flag', () => {
  const snapshot = createSnapshot()

  const locked = applyMutation(snapshot, {
    type: 'setTeamLockState',
    teamId: 'team-1',
    locked: true,
  })
  assert.equal(locked.teams[0].config.locked, true)

  const unlocked = applyMutation(locked, {
    type: 'setTeamLockState',
    teamId: 'team-1',
    locked: false,
  })
  assert.equal(unlocked.teams[0].config.locked, false)
})
