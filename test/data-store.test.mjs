import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyMutation,
  validateDataReplacement,
  validateExpectedSlotMember,
  validateSlotMutationLock,
} from '../server/data-store.js'
import { applyMutation as applyClientMutation } from '../src/dataStore.ts'

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
  }
}

function fixedRoleSlotNumbers(snapshot, role) {
  return snapshot.teams[0].slots
    .filter(slot => slot.status === 'fixed' && slot.fixedRole === role)
    .map(slot => slot.index + 1)
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
  assert.equal(second.logs.length, 2)
  assert.equal(second.logs[0].actorQq, '10001')
  assert.match(second.logs[0].action, /报名 #1/)
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
  assert.equal(next.logs.length, 1)
  assert.equal(next.logs[0].actorQq, 'admin')
  assert.match(next.logs[0].action, /取消 #3/)
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

test('validateDataReplacement rejects empty snapshots and accidental overwrites', () => {
  const current = createSnapshot()

  const empty = validateDataReplacement(current, { teams: [], cancellations: [], archivedTeams: [], logs: [] })
  assert.equal(empty.ok, false)
  assert.equal(empty.status, 400)

  const accidentalOverwrite = validateDataReplacement(current, {
    teams: [{ ...createSnapshot().teams[0], id: 'team-other' }],
    cancellations: [],
    archivedTeams: [],
    logs: [],
  })
  assert.equal(accidentalOverwrite.ok, false)
  assert.equal(accidentalOverwrite.status, 409)

  const explicitOverwrite = validateDataReplacement(current, {
    teams: [{ ...createSnapshot().teams[0], id: 'team-other' }],
    cancellations: [],
    archivedTeams: [],
    logs: [],
  }, { allowReplace: true })
  assert.equal(explicitOverwrite.ok, true)
  assert.equal(explicitOverwrite.shouldBackup, true)
})

test('validateDataReplacement allows bootstrap only with a valid non-empty snapshot', () => {
  const result = validateDataReplacement(
    { teams: [], cancellations: [], archivedTeams: [], logs: [] },
    createSnapshot(),
  )
  assert.equal(result.ok, true)
  assert.equal(result.shouldBackup, false)

  const invalid = validateDataReplacement(
    { teams: [], cancellations: [], archivedTeams: [], logs: [] },
    { teams: [{ id: 'broken' }], cancellations: [], archivedTeams: [], logs: [] },
  )
  assert.equal(invalid.ok, false)
  assert.equal(invalid.status, 400)
})

test('validateDataReplacement rejects malformed team slots', () => {
  const current = { teams: [], cancellations: [], archivedTeams: [], logs: [] }

  const missingSlots = createSnapshot()
  missingSlots.teams[0].slots = []
  const missingSlotsResult = validateDataReplacement(current, missingSlots)
  assert.equal(missingSlotsResult.ok, false)
  assert.equal(missingSlotsResult.status, 400)

  const badIndex = createSnapshot()
  badIndex.teams[0].slots[0].index = 8
  const badIndexResult = validateDataReplacement(current, badIndex)
  assert.equal(badIndexResult.ok, false)
  assert.equal(badIndexResult.status, 400)

  const missingMember = createSnapshot()
  missingMember.teams[0].slots[0].status = 'occupied'
  const missingMemberResult = validateDataReplacement(current, missingMember)
  assert.equal(missingMemberResult.ok, false)
  assert.equal(missingMemberResult.status, 400)

  const malformedMember = createSnapshot()
  malformedMember.teams[0].slots[0] = {
    ...malformedMember.teams[0].slots[0],
    status: 'occupied',
    member: {
      qq: '10001',
      martialArtIndex: '1',
      gearScore: 1200,
      characterId: 'A',
      note: '',
    },
  }
  const malformedMemberResult = validateDataReplacement(current, malformedMember)
  assert.equal(malformedMemberResult.ok, false)
  assert.equal(malformedMemberResult.status, 400)
})

test('renameTeam preserves regular emoji and embedded image markers', () => {
  for (const apply of [applyMutation, applyClientMutation]) {
    const emoji = apply(createSnapshot(), {
      type: 'renameTeam',
      teamId: 'team-1',
      name: '一团 🌸🧑‍🚀',
    })
    assert.equal(emoji.teams[0].name, '一团 🌸🧑‍🚀')

    const imageMarker = apply(emoji, {
      type: 'renameTeam',
      teamId: 'team-1',
      name: '\uFFFC 图片团 \uFFFC',
    })
    assert.equal(imageMarker.teams[0].name, '\uFFFC 图片团 \uFFFC')
    assert.equal(imageMarker.teams[0].slots.length, 25)
  }
})

test('applyMutation preserves special text fields and reserved object keys', () => {
  for (const apply of [applyMutation, applyClientMutation]) {
    const specialText = '角色\uFFFC 🌸\uD800\n第二行'
    const imageData = `data:image/png;base64,${Buffer.from('fake image data').toString('base64')}`
    const typeId = 'type-\uFFFC'
    const levelName = '第一\uD800'

    const signed = apply(createSnapshot(), {
      type: 'signupSlot',
      teamId: 'team-1',
      slotIndex: 0,
      member: {
        qq: '__proto__',
        martialArtIndex: '1',
        gearScore: '1200',
        characterId: specialText,
        note: imageData,
        hasOrangeWeapon: true,
      },
    })
    assert.equal(signed.teams[0].slots[0].member?.characterId, specialText)
    assert.equal(signed.teams[0].slots[0].member?.note, imageData)

    const noted = apply(signed, {
      type: 'updateTeamNote',
      teamId: 'team-1',
      note: `${specialText}\n${imageData}`,
    })
    assert.equal(noted.teams[0].note, `${specialText}\n${imageData}`)

    const configured = apply(noted, {
      type: 'updateTeamSubsidyTypes',
      teamId: 'team-1',
      subsidyTypes: [{
        id: typeId,
        name: '图片补贴\uFFFC',
        levels: [{ name: levelName, gold: '5000' }],
      }],
    })
    const registered = apply(configured, {
      type: 'registerMemberSubsidies',
      teamId: 'team-1',
      qq: '__proto__',
      selections: [{ typeId, levelName }],
    })
    const storedSelections = Object.getOwnPropertyDescriptor(registered.teams[0].memberSubsidies, '__proto__')?.value
    assert.deepEqual(storedSelections, [{ typeId, levelName }])

    const cleaned = apply(registered, {
      type: 'updateTeamSubsidyTypes',
      teamId: 'team-1',
      subsidyTypes: configured.teams[0].subsidyTypes,
    })
    const cleanedSelections = Object.getOwnPropertyDescriptor(cleaned.teams[0].memberSubsidies, '__proto__')?.value
    assert.deepEqual(cleanedSelections, [{ typeId, levelName }])
  }
})

test('quickReserve prioritizes T slots from #21 to #25', () => {
  for (const apply of [applyMutation, applyClientMutation]) {
    const next = apply(createSnapshot(), {
      type: 'quickReserve',
      teamId: 'team-1',
      reserveType: 'T',
      count: 3,
    })

    assert.deepEqual(fixedRoleSlotNumbers(next, 'T'), [21, 22, 23])
  }
})

test('quickReserve prioritizes healer slots from #16 to #20', () => {
  for (const apply of [applyMutation, applyClientMutation]) {
    const next = apply(createSnapshot(), {
      type: 'quickReserve',
      teamId: 'team-1',
      reserveType: '治疗',
      count: 2,
    })

    assert.deepEqual(fixedRoleSlotNumbers(next, '治疗'), [16, 17])
  }
})

test('quickReserve shrink keeps the preferred role slots first', () => {
  for (const apply of [applyMutation, applyClientMutation]) {
    const expanded = apply(createSnapshot(), {
      type: 'quickReserve',
      teamId: 'team-1',
      reserveType: 'T',
      count: 4,
    })
    const shrunk = apply(expanded, {
      type: 'quickReserve',
      teamId: 'team-1',
      reserveType: 'T',
      count: 2,
    })

    assert.deepEqual(fixedRoleSlotNumbers(shrunk, 'T'), [21, 22])
  }
})

test('archiveTeam moves team into archives and creates fallback', () => {
  const snapshot = createSnapshot()
  const fallbackTeam = {
    ...createSnapshot().teams[0],
    id: 'team-fallback',
    name: '新团队',
  }

  const next = applyMutation(snapshot, {
    type: 'archiveTeam',
    teamId: 'team-1',
    archivedBy: 'admin',
    archivedAt: 222,
    fallbackTeam,
  })

  assert.equal(next.teams.length, 1)
  assert.equal(next.teams[0].id, 'team-fallback')
  assert.equal(next.archivedTeams.length, 1)
  assert.equal(next.archivedTeams[0].team.id, 'team-1')
  assert.equal(next.archivedTeams[0].archivedBy, 'admin')
  assert.equal(next.logs.length, 1)
  assert.equal(next.logs[0].action, '归档表格')
})

test('restoreArchivedTeam restores archived team and appends log', () => {
  const archived = applyMutation(createSnapshot(), {
    type: 'archiveTeam',
    teamId: 'team-1',
    archivedBy: 'admin',
    archivedAt: 222,
    fallbackTeam: {
      ...createSnapshot().teams[0],
      id: 'team-fallback',
      name: '新团队',
    },
  })

  const restored = applyMutation(archived, {
    type: 'restoreArchivedTeam',
    archiveId: archived.archivedTeams[0].id,
    actorQq: 'admin',
    restoredAt: 333,
  })

  assert.equal(restored.archivedTeams.length, 0)
  assert.equal(restored.teams.some(team => team.id === 'team-1'), true)
  assert.equal(restored.logs.at(-1).action, '恢复表格')
})
