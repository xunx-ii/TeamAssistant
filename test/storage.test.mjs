import test from 'node:test'
import assert from 'node:assert/strict'

import { hasHydratableTeams } from '../src/storage.ts'

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
