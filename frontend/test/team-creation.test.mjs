import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeHydratableData as normalizeClientHydratableData } from '../src/dataHydration.ts'
import { createSubsidyTargets } from '../src/subsidy.ts'
import {
  createTeamCopies,
  createTeamFromGuide,
  createTeamsFromGuide,
  normalizeCreateTeamReserveCount,
  normalizeTeamBatchCount,
} from '../src/teamCreation.ts'
import { validateSnapshotData } from '../src/dataStore.ts'

const now = new Date('2026-05-09T10:00:00+08:00')

const presets = [
  {
    id: 'damage',
    name: '伤害补贴',
    levels: [{ name: '第一', gold: 8000 }],
  },
  {
    id: 'heal',
    name: '治疗补贴',
    levels: [{ name: '第一', gold: 5000 }],
  },
]

function createGuide(overrides = {}) {
  return {
    name: '下周补贴团',
    weekStart: '2026-05-11',
    subsidyPresetIds: ['damage'],
    quickReserve: true,
    reserveT: 2,
    reserveHealer: 2,
    reserveBoss: 1,
    ...overrides,
  }
}

test('createTeamFromGuide imports selected presets and applies initial slot limits', () => {
  const team = createTeamFromGuide(createGuide(), presets, now)

  assert.equal(team.name, '下周补贴团')
  assert.equal(team.weekStart, '2026-05-11')
  assert.deepEqual(team.subsidyTypes, [presets[0]])
  assert.equal(team.config.onlyTnSignup, false)
  assert.equal(team.config.uniqueQqSignup, false)
  assert.deepEqual(team.config.reservedSlots, [0])
  assert.equal(team.slots[20].status, 'fixed')
  assert.equal(team.slots[20].fixedRole, 'T')
  assert.equal(team.slots[21].fixedRole, 'T')
  assert.equal(team.slots[15].fixedRole, '治疗')
  assert.equal(team.slots[16].fixedRole, '治疗')
  assert.equal(team.slots[0].status, 'reserved')
})

test('createTeamFromGuide stores signup rule switches', () => {
  const team = createTeamFromGuide(createGuide({
    onlyTnSignup: true,
    uniqueQqSignup: true,
    quickReserve: false,
  }), presets, now)

  assert.equal(team.config.onlyTnSignup, true)
  assert.equal(team.config.uniqueQqSignup, true)
  assert.equal(validateSnapshotData({
    teams: [team],
    cancellations: [],
    archivedTeams: [],
    logs: [],
    userProfiles: {},
  }), true)
})

test('createTeamsFromGuide creates numbered teams with identical settings', () => {
  const teams = createTeamsFromGuide(createGuide({
    name: '周末团',
    count: 3,
    onlyTnSignup: true,
    uniqueQqSignup: true,
  }), presets, now)

  assert.deepEqual(teams.map(team => team.name), ['周末团 1', '周末团 2', '周末团 3'])
  assert.equal(new Set(teams.map(team => team.id)).size, 3)
  assert.equal(teams.every(team => team.config.onlyTnSignup), true)
  assert.equal(teams.every(team => team.config.uniqueQqSignup), true)
  assert.equal(teams.every(team => team.slots[20].fixedRole === 'T'), true)
  assert.equal(teams.every(team => team.subsidyTypes?.[0]?.id === 'damage'), true)
})

test('createTeamCopies preserves configuration and clears runtime member data', () => {
  const source = createTeamFromGuide(createGuide({
    name: '模板团',
    onlyTnSignup: true,
    uniqueQqSignup: true,
  }), presets, now)
  source.note = '固定打法'
  source.config.locked = true
  source.slots[2] = {
    index: 2,
    status: 'occupied',
    member: {
      qq: '10001',
      martialArtIndex: '3',
      gearScore: '1200',
      characterId: '冰心角色',
      note: '',
    },
    fixedRole: 'DPS',
    fixedMartialArtIndex: 3,
  }
  source.slots[3] = {
    index: 3,
    status: 'occupied',
    member: {
      qq: '10002',
      martialArtIndex: '5',
      gearScore: '1300',
      characterId: '普通角色',
      note: '',
    },
    fixedRole: null,
    fixedMartialArtIndex: null,
  }
  source.memberSubsidies = {
    '10001': [{ typeId: 'damage', levelName: '第一', weekStart: '2026-05-11' }],
  }

  const copies = createTeamCopies(source, '模板复制', 2)

  assert.deepEqual(copies.map(team => team.name), ['模板复制 1', '模板复制 2'])
  assert.equal(copies.every(team => team.note === '固定打法'), true)
  assert.equal(copies.every(team => team.config.locked === false), true)
  assert.equal(copies.every(team => team.config.onlyTnSignup), true)
  assert.equal(copies.every(team => team.slots[2].status === 'fixed'), true)
  assert.equal(copies.every(team => team.slots[2].fixedMartialArtIndex === 3), true)
  assert.equal(copies.every(team => team.slots[3].status === 'empty'), true)
  assert.equal(copies.every(team => team.slots.every(slot => slot.member === null)), true)
  assert.equal(copies.every(team => team.memberSubsidies === undefined), true)
  assert.notEqual(copies[0].subsidyTypes, source.subsidyTypes)
})

test('team weekStart survives hydration and drives subsidy targets', () => {
  const team = createTeamFromGuide(createGuide({ quickReserve: false }), presets, now)
  const snapshot = {
    teams: [team],
    cancellations: [],
    archivedTeams: [{
      id: 'archive-1',
      team: { ...team, id: 'archived-team', name: '归档团', weekStart: '2026-05-18' },
      archivedAt: new Date('2026-05-06T12:00:00+08:00').getTime(),
      archivedBy: 'admin',
    }],
    logs: [],
  }

  assert.equal(normalizeClientHydratableData(snapshot).teams[0].weekStart, '2026-05-11')
  const hydrated = normalizeClientHydratableData(snapshot)
  assert.equal(hydrated.teams[0].weekStart, '2026-05-11')
  assert.equal(validateSnapshotData(hydrated), true)

  const targets = createSubsidyTargets(snapshot.teams, snapshot.archivedTeams, '10001', '2026-05-04')
  assert.deepEqual(targets.map(target => target.weekStart), ['2026-05-11', '2026-05-18'])
})

test('create team reserve counts are clamped to slot bounds', () => {
  assert.equal(normalizeCreateTeamReserveCount('999'), 25)
  assert.equal(normalizeCreateTeamReserveCount('-3'), 0)
  assert.equal(normalizeCreateTeamReserveCount('bad'), 0)
})

test('team batch counts are clamped to supported bounds', () => {
  assert.equal(normalizeTeamBatchCount('0'), 1)
  assert.equal(normalizeTeamBatchCount('3'), 3)
  assert.equal(normalizeTeamBatchCount('999'), 50)
  assert.equal(normalizeTeamBatchCount('bad'), 1)
})
