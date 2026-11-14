import test from 'node:test'
import assert from 'node:assert/strict'

import {
  findUniqueSignupConflictSlot,
  getSlotRoleMartialArtOptions,
  hasTeamSignup,
  isTnRole,
} from '../src/signupRules.ts'
import { martialArts } from '../src/data/martialArts.ts'

function createSlots() {
  return Array.from({ length: 25 }, (_, index) => ({
    index,
    status: 'empty',
    member: null,
    fixedRole: null,
    fixedMartialArtIndex: null,
  }))
}

test('findUniqueSignupConflictSlot ignores the current slot and finds duplicate QQs elsewhere', () => {
  const slots = createSlots()
  slots[3].member = {
    qq: '10001',
    martialArtIndex: '1',
    gearScore: '1200',
    characterId: 'Tank',
    note: '',
  }

  assert.equal(findUniqueSignupConflictSlot(slots, '10001', 3), null)
  assert.equal(findUniqueSignupConflictSlot(slots, '10001', 4)?.index, 3)
  assert.equal(findUniqueSignupConflictSlot(slots, '10002', 4), null)
})

test('getSlotRoleMartialArtOptions filters DPS while preserving original martial art indexes', () => {
  const options = getSlotRoleMartialArtOptions(true)

  assert.equal(options.length > 0, true)
  assert.equal(options.every(option => isTnRole(option.martialArt.role)), true)
  assert.equal(options.some(option => option.martialArt.role === 'DPS'), false)
  assert.deepEqual(
    options.map(option => option.index),
    martialArts
      .map((martialArt, index) => ({ martialArt, index }))
      .filter(option => isTnRole(option.martialArt.role))
      .map(option => option.index),
  )
})

test('getSlotRoleMartialArtOptions returns all options when TN-only is disabled', () => {
  assert.equal(getSlotRoleMartialArtOptions(false).length, martialArts.length)
})

test('hasTeamSignup marks only teams containing the current QQ', () => {
  const slots = createSlots()
  slots[6].member = {
    qq: '10001',
    martialArtIndex: '3',
    gearScore: '1200',
    characterId: '角色A',
    note: '',
  }

  assert.equal(hasTeamSignup({ slots }, '10001'), true)
  assert.equal(hasTeamSignup({ slots }, '10002'), false)
  assert.equal(hasTeamSignup({ slots }, null), false)
})
