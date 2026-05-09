import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeHydratableData as normalizeClientHydratableData } from '../src/dataHydration.ts'
import { createSubsidyTargets } from '../src/subsidy.ts'
import {
  createTeamFromGuide,
  normalizeCreateTeamReserveCount,
  resolveCreateTeamWeekStart,
} from '../src/teamCreation.ts'
import { normalizeHydratableData as normalizeServerHydratableData, validateSnapshotData } from '../server/data-store.js'

const now = new Date('2026-05-09T10:00:00+08:00')

const presets = [{
  id: 'damage',
  name: '伤害补贴',
  levels: [{ name: '第一', gold: 8000 }],
}]

function createGuide(overrides = {}) {
  return {
    name: '下周补贴团',
    weekMode: 'nextWeek',
    customDate: '',
    importSubsidyPresets: true,
    quickReserve: true,
    reserveT: 2,
    reserveHealer: 2,
    reserveBoss: 1,
    ...overrides,
  }
}

test('create team guide resolves preset weeks and custom dates', () => {
  assert.equal(resolveCreateTeamWeekStart(createGuide({ weekMode: 'thisWeek' }), now), '2026-05-04')
  assert.equal(resolveCreateTeamWeekStart(createGuide({ weekMode: 'nextWeek' }), now), '2026-05-11')
  assert.equal(resolveCreateTeamWeekStart(createGuide({ weekMode: 'custom', customDate: '2026-05-17' }), now), '2026-05-11')
  assert.equal(resolveCreateTeamWeekStart(createGuide({ weekMode: 'custom', customDate: 'bad' }), now), '2026-05-04')
})

test('createTeamFromGuide imports presets and applies initial slot limits', () => {
  const team = createTeamFromGuide(createGuide(), presets, now)

  assert.equal(team.name, '下周补贴团')
  assert.equal(team.weekStart, '2026-05-11')
  assert.deepEqual(team.subsidyTypes, presets)
  assert.deepEqual(team.config.reservedSlots, [0])
  assert.equal(team.slots[20].status, 'fixed')
  assert.equal(team.slots[20].fixedRole, 'T')
  assert.equal(team.slots[21].fixedRole, 'T')
  assert.equal(team.slots[15].fixedRole, '治疗')
  assert.equal(team.slots[16].fixedRole, '治疗')
  assert.equal(team.slots[0].status, 'reserved')
})

test('team weekStart survives client and server hydration and drives subsidy targets', () => {
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
  const serverHydrated = normalizeServerHydratableData(snapshot)
  assert.equal(serverHydrated.teams[0].weekStart, '2026-05-11')
  assert.equal(validateSnapshotData(serverHydrated), true)

  const targets = createSubsidyTargets(snapshot.teams, snapshot.archivedTeams, '10001', '2026-05-04')
  assert.deepEqual(targets.map(target => target.weekStart), ['2026-05-11', '2026-05-18'])
})

test('create team reserve counts are clamped to slot bounds', () => {
  assert.equal(normalizeCreateTeamReserveCount('999'), 25)
  assert.equal(normalizeCreateTeamReserveCount('-3'), 0)
  assert.equal(normalizeCreateTeamReserveCount('bad'), 0)
})
