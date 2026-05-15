import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyMutation,
  applyMutation as applyClientMutation,
  validateDataReplacement,
  validateExpectedSlotMember,
  validateSnapshotData,
  validateSlotMutationLock,
} from '../src/dataStore.ts'
import {
  normalizeHydratableData,
  normalizeHydratableData as normalizeClientHydratableData,
} from '../src/dataHydration.ts'
import { createSubsidyTargets, getSubsidyWeekOptions } from '../src/subsidy.ts'
import { formatWeekRange } from '../src/week.ts'

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

test('validateSlotMutationLock lets administrators override team locks', () => {
  const slotLocks = new Map([
    ['team-1:0', { qq: 'admin', timestamp: 1000 }],
  ])
  const teamLocks = new Map([
    ['team-1', 2000],
  ])

  const blocked = validateSlotMutationLock({
    slotLocks,
    teamLocks,
    teamId: 'team-1',
    slotIndex: 0,
    qq: 'admin',
    lockTimestamp: 1000,
    lockTimeout: 30_000,
    now: 1001,
  })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'teamLocked')

  const allowed = validateSlotMutationLock({
    slotLocks,
    teamLocks,
    teamId: 'team-1',
    slotIndex: 0,
    qq: 'admin',
    lockTimestamp: 1000,
    lockTimeout: 30_000,
    ignoreTeamLock: true,
    now: 1001,
  })
  assert.equal(allowed.ok, true)
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

test('cancelSlot restores fixed slot after signup and hydration', () => {
  for (const [apply, hydrate] of [
    [applyMutation, normalizeHydratableData],
    [applyClientMutation, normalizeClientHydratableData],
  ]) {
    const fixed = apply(createSnapshot(), {
      type: 'setSlotRole',
      teamId: 'team-1',
      slotIndex: 4,
      role: 'T',
      martialArtIndex: null,
    })
    const signed = apply(fixed, {
      type: 'signupSlot',
      teamId: 'team-1',
      slotIndex: 4,
      member: {
        qq: '10001',
        martialArtIndex: '1',
        gearScore: '1200',
        characterId: 'Tank',
        note: '',
      },
    })
    const hydrated = hydrate(signed)
    const cancelled = apply(hydrated, {
      type: 'cancelSlot',
      teamId: 'team-1',
      slotIndex: 4,
      reason: '时间冲突',
      cancelledBy: 'admin',
      timestamp: 123456,
    })

    assert.equal(cancelled.teams[0].slots[4].status, 'fixed')
    assert.equal(cancelled.teams[0].slots[4].member, null)
    assert.equal(cancelled.teams[0].slots[4].fixedRole, 'T')
    assert.equal(cancelled.teams[0].slots[4].fixedMartialArtIndex, null)
  }
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

test('updateTeamWeekStart stores valid team week values', () => {
  for (const apply of [applyMutation, applyClientMutation]) {
    const next = apply(createSnapshot(), {
      type: 'updateTeamWeekStart',
      teamId: 'team-1',
      weekStart: '2026-05-11',
    })
    assert.equal(next.teams[0].weekStart, '2026-05-11')

    const normalized = apply(next, {
      type: 'updateTeamWeekStart',
      teamId: 'team-1',
      weekStart: '2026-05-24',
    })
    assert.equal(normalized.teams[0].weekStart, '2026-05-18')

    const ignored = apply(normalized, {
      type: 'updateTeamWeekStart',
      teamId: 'team-1',
      weekStart: 'bad-value',
    })
    assert.equal(ignored.teams[0].weekStart, '2026-05-18')

    const invalidDate = apply(normalized, {
      type: 'updateTeamWeekStart',
      teamId: 'team-1',
      weekStart: '2026-99-99',
    })
    assert.equal(invalidDate.teams[0].weekStart, '2026-05-18')
  }
})

test('team weekStart validation rejects invalid stored dates', () => {
  const monday = createSnapshot()
  monday.teams[0].weekStart = '2026-05-18'
  assert.equal(validateSnapshotData(monday), true)

  const nonMonday = createSnapshot()
  nonMonday.teams[0].weekStart = '2026-05-24'
  assert.equal(validateSnapshotData(nonMonday), false)

  const invalidDate = createSnapshot()
  invalidDate.teams[0].weekStart = '2026-99-99'
  assert.equal(validateSnapshotData(invalidDate), false)
})

test('hydration normalizes team and subsidy week starts', () => {
  const snapshot = createSnapshot()
  snapshot.teams[0].weekStart = '2026-05-24'
  snapshot.teams[0].memberSubsidies = {
    10001: [
      { typeId: 'damage', levelName: '高', weekStart: '2026-05-24' },
      { typeId: 'damage', levelName: '坏日期', weekStart: '2026-99-99' },
    ],
  }

  for (const hydrate of [normalizeHydratableData, normalizeClientHydratableData]) {
    const hydrated = hydrate(snapshot)
    assert.equal(hydrated.teams[0].weekStart, '2026-05-18')
    assert.equal(hydrated.teams[0].memberSubsidies['10001'][0].weekStart, '2026-05-18')
    assert.equal('weekStart' in hydrated.teams[0].memberSubsidies['10001'][1], false)
  }
})

test('hydration defaults missing user profiles and normalizes nicknames', () => {
  const snapshot = createSnapshot()
  delete snapshot.userProfiles

  for (const hydrate of [normalizeHydratableData, normalizeClientHydratableData]) {
    const hydrated = hydrate(snapshot)
    assert.deepEqual(hydrated.userProfiles, {})

    const withProfiles = hydrate({
      ...snapshot,
      userProfiles: {
        10001: { nickname: '  Alice   Beta  ' },
        10002: { nickname: 'abcdefghijklmnopqrstuv' },
        10003: { nickname: '' },
      },
    })
    assert.deepEqual(withProfiles.userProfiles['10001'], { nickname: 'Alice Beta' })
    assert.equal(withProfiles.userProfiles['10002'].nickname, 'abcdefghijklmnopqrst')
    assert.equal(withProfiles.userProfiles['10003'], undefined)
  }
})

test('updateNickname stores duplicate nicknames and appends global logs', () => {
  for (const apply of [applyMutation, applyClientMutation]) {
    const first = apply(createSnapshot(), {
      type: 'updateNickname',
      qq: '10001',
      nickname: '  兔扇  ',
    })
    assert.equal(first.userProfiles['10001'].nickname, '兔扇')
    assert.equal(first.logs.at(-1).teamId, '')
    assert.equal(first.logs.at(-1).actorQq, '10001')
    assert.equal(first.logs.at(-1).action, '设置昵称：兔扇')

    const duplicate = apply(first, {
      type: 'updateNickname',
      qq: '10002',
      nickname: '兔扇',
    })
    assert.equal(duplicate.userProfiles['10002'].nickname, '兔扇')
    assert.equal(duplicate.logs.at(-1).action, '设置昵称：兔扇')

    const renamed = apply(duplicate, {
      type: 'updateNickname',
      qq: '10001',
      nickname: '新兔扇',
    })
    assert.equal(renamed.userProfiles['10001'].nickname, '新兔扇')
    assert.equal(renamed.logs.at(-1).action, '修改昵称：兔扇 -> 新兔扇')
  }
})

test('validateSnapshotData rejects unnormalized user profile nicknames', () => {
  const blank = createSnapshot()
  blank.userProfiles = { 10001: { nickname: '   ' } }
  assert.equal(validateSnapshotData(blank), false)

  const padded = createSnapshot()
  padded.userProfiles = { 10001: { nickname: ' 兔扇 ' } }
  assert.equal(validateSnapshotData(padded), false)

  const normalized = createSnapshot()
  normalized.userProfiles = { 10001: { nickname: '兔扇' } }
  assert.equal(validateSnapshotData(normalized), true)
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

test('normalizeHydratableData repairs legacy team shapes for rendering', () => {
  const hydrated = normalizeHydratableData({
    teams: [{
      id: 'legacy-team',
      name: '旧团',
      slots: [],
    }],
    cancellations: [{ qq: 10001, reason: null }],
    archivedTeams: [],
    logs: [],
  })

  assert.equal(hydrated.teams.length, 1)
  assert.equal(hydrated.teams[0].note, '')
  assert.equal(hydrated.teams[0].config.locked, false)
  assert.equal(hydrated.teams[0].slots.length, 25)
  assert.equal(hydrated.teams[0].slots[0].index, 0)
  assert.equal(validateSnapshotData(hydrated), true)
})

test('validateSnapshotData catches malformed teams created by mutations', () => {
  const mutated = applyMutation(createSnapshot(), {
    type: 'createTeam',
    team: {
      id: 'broken-team',
      name: '坏团',
      slots: [],
    },
  })

  assert.equal(validateSnapshotData(mutated), false)
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

test('registerMemberSubsidies replaces only the selected week', () => {
  for (const apply of [applyMutation, applyClientMutation]) {
    const snapshot = createSnapshot()
    snapshot.teams[0].memberSubsidies = {
      10001: [
        { typeId: 'damage', levelName: '上周', weekStart: '2026-04-27' },
        { typeId: 'damage', levelName: '旧本周', weekStart: '2026-05-04' },
        { typeId: 'damage', levelName: '旧记录' },
      ],
    }

    const next = apply(snapshot, {
      type: 'registerMemberSubsidies',
      teamId: 'team-1',
      qq: '10001',
      selections: [{ typeId: 'damage', levelName: '新本周' }],
      weekStart: '2026-05-04',
    })

    assert.deepEqual(next.teams[0].memberSubsidies['10001'], [
      { typeId: 'damage', levelName: '上周', weekStart: '2026-04-27' },
      { typeId: 'damage', levelName: '新本周', weekStart: '2026-05-04' },
    ])

    const normalizedWeek = apply(next, {
      type: 'registerMemberSubsidies',
      teamId: 'team-1',
      qq: '10001',
      selections: [{ typeId: 'damage', levelName: '周日记录' }],
      weekStart: '2026-05-24',
    })
    assert.deepEqual(normalizedWeek.teams[0].memberSubsidies['10001'], [
      { typeId: 'damage', levelName: '上周', weekStart: '2026-04-27' },
      { typeId: 'damage', levelName: '新本周', weekStart: '2026-05-04' },
      { typeId: 'damage', levelName: '周日记录', weekStart: '2026-05-18' },
    ])

    const invalidWeek = apply(normalizedWeek, {
      type: 'registerMemberSubsidies',
      teamId: 'team-1',
      qq: '10001',
      selections: [{ typeId: 'damage', levelName: '坏日期' }],
      weekStart: '2026-99-99',
    })
    assert.deepEqual(invalidWeek.teams[0].memberSubsidies['10001'], normalizedWeek.teams[0].memberSubsidies['10001'])
  }
})

test('registerMemberSubsidies can write archived team records', () => {
  for (const apply of [applyMutation, applyClientMutation]) {
    const snapshot = createSnapshot()
    snapshot.teams[0].subsidyTypes = [{
      id: 'damage',
      name: '伤害补贴',
      levels: [{ name: '高', gold: 500 }],
    }]
    const archived = apply(snapshot, {
      type: 'archiveTeam',
      teamId: 'team-1',
      archivedBy: 'admin',
      archivedAt: new Date(2026, 4, 6).getTime(),
      fallbackTeam: {
        ...createSnapshot().teams[0],
        id: 'team-fallback',
        name: '新团队',
      },
    })
    const next = apply(archived, {
      type: 'registerMemberSubsidies',
      archiveId: archived.archivedTeams[0].id,
      qq: '10001',
      selections: [{ typeId: 'damage', levelName: '高' }],
      weekStart: '2026-05-04',
    })

    assert.deepEqual(next.archivedTeams[0].team.memberSubsidies['10001'], [
      { typeId: 'damage', levelName: '高', weekStart: '2026-05-04' },
    ])
    assert.equal(next.teams[0].memberSubsidies?.['10001'], undefined)
  }
})

test('createSubsidyTargets includes current week archived teams and week options', () => {
  const subsidyTypes = [{
    id: 'damage',
    name: '伤害补贴',
    levels: [{ name: '高', gold: 500 }],
  }]
  const activeTeam = {
    ...createSnapshot().teams[0],
    subsidyTypes,
    memberSubsidies: {
      10001: [
        { typeId: 'damage', levelName: '高', weekStart: '2026-05-04' },
      ],
      10002: [
        { typeId: 'damage', levelName: '高', weekStart: '2026-04-27' },
      ],
    },
  }
  const currentWeekArchive = {
    id: 'archive-current',
    team: {
      ...createSnapshot().teams[0],
      id: 'archived-current-team',
      name: '本周归档',
      subsidyTypes,
      memberSubsidies: {
        10001: [{ typeId: 'damage', levelName: '高' }],
      },
    },
    archivedAt: new Date(2026, 4, 6).getTime(),
    archivedBy: 'admin',
  }
  const oldArchive = {
    id: 'archive-old',
    team: {
      ...createSnapshot().teams[0],
      id: 'archived-old-team',
      name: '旧归档',
      subsidyTypes,
      memberSubsidies: {},
    },
    archivedAt: new Date(2026, 3, 29).getTime(),
    archivedBy: 'admin',
  }

  const targets = createSubsidyTargets([activeTeam], [currentWeekArchive, oldArchive], '10001', '2026-05-04')
  assert.deepEqual(targets.filter(target => target.weekStart === '2026-05-04').map(target => target.name), [
    '一团',
    '本周归档（归档）',
  ])
  assert.deepEqual(targets.find(target => target.id === 'archive:archive-current')?.currentSelections, [
    { typeId: 'damage', levelName: '高', weekStart: '2026-05-04' },
  ])
  assert.deepEqual(getSubsidyWeekOptions(targets, '2026-05-04'), ['2026-05-04', '2026-04-27'])
  assert.equal(formatWeekRange('2026-05-04'), '2026年5月4日-2026年5月10日周')
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
