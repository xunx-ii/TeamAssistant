import test from 'node:test'
import assert from 'node:assert/strict'

import { createSubsidyTargets, getSubsidyRegistrationTargets } from '../src/subsidy.ts'
import { createSubsidyStatRows, getSubsidyStatUserLines } from '../src/components/SubsidyStats.tsx'

function createTeam(id, name, weekStart) {
  return {
    id,
    name,
    weekStart,
    subsidyTypes: [{
      id: 'damage',
      name: '伤害补贴',
      levels: [{ name: '高', gold: 500 }],
    }],
    memberSubsidies: {},
    config: { reservedSlots: [], locked: false },
    slots: [],
  }
}

test('subsidy registration targets only keep current week teams', () => {
  const currentWeekStart = '2026-05-11'
  const targets = createSubsidyTargets(
    [
      createTeam('team-future', '下周团', '2026-05-18'),
      createTeam('team-current', '本周团', '2026-05-11'),
    ],
    [
      {
        id: 'archive-future',
        team: createTeam('archived-future', '归档下周团', '2026-05-18'),
        archivedAt: Date.parse('2026-05-06T12:00:00+08:00'),
        archivedBy: 'admin',
      },
      {
        id: 'archive-current',
        team: createTeam('archived-current', '归档本周团', '2026-05-11'),
        archivedAt: Date.parse('2026-05-06T13:00:00+08:00'),
        archivedBy: 'admin',
      },
    ],
    '10001',
    currentWeekStart,
  )

  const registrationTargets = getSubsidyRegistrationTargets(targets, currentWeekStart)
  assert.deepEqual(registrationTargets.map(target => target.id), ['team:team-current', 'archive:archive-current'])
})

test('subsidy stats rows expose QQ and nickname as separate user lines', () => {
  const team = createTeam('team-current', '本周团', '2026-05-11')
  team.memberSubsidies = {
    10001: [{ typeId: 'damage', levelName: '高', weekStart: '2026-05-11' }],
  }
  const targets = createSubsidyTargets([team], [], '10001', '2026-05-11')
  const rows = createSubsidyStatRows(targets, '2026-05-11')

  assert.equal(rows.length, 1)
  assert.equal(rows[0].qq, '10001')
  assert.deepEqual(getSubsidyStatUserLines(rows[0], { 10001: { nickname: '兔扇' } }), ['10001', '兔扇'])
  assert.deepEqual(getSubsidyStatUserLines(rows[0], {}), ['10001', '未设置'])
})
