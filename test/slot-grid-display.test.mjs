import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getAvailableSlotLabel,
  getFixedSlotLabel,
  getOccupiedSlotDisplay,
  getReservedSlotLabel,
  shouldShowAvailableMarker,
  slotAcceptsSignup,
} from '../src/components/slotGridDisplay.ts'

const emptySlot = {
  index: 0,
  status: 'empty',
  member: null,
  fixedRole: null,
  fixedMartialArtIndex: null,
}

test('slot availability markers stay visible on empty, fixed, and reserved slots', () => {
  assert.equal(slotAcceptsSignup(emptySlot), true)
  assert.equal(shouldShowAvailableMarker(emptySlot, false), true)
  assert.equal(shouldShowAvailableMarker(emptySlot, true), false)
  assert.equal(getAvailableSlotLabel(false), '可选')
  assert.equal(getAvailableSlotLabel(true), '⏳ 报名中')
  assert.equal(getReservedSlotLabel(false), '老板位')
  assert.equal(getReservedSlotLabel(true), '⏳ 报名中')
})

test('fixed slots show a readable availability hint when not locked', () => {
  assert.equal(
    getFixedSlotLabel({ fixedRole: 'T', fixedMartialArtIndex: null }, false),
    '🛡️ T 位',
  )
  assert.equal(
    getFixedSlotLabel({ fixedRole: '治疗', fixedMartialArtIndex: null }, false),
    '💚 奶 位',
  )
  assert.equal(
    getFixedSlotLabel({ fixedRole: 'DPS', fixedMartialArtIndex: null }, true),
    '⏳ 报名中',
  )
})

test('occupied own slots receive the red outline class', () => {
  const display = getOccupiedSlotDisplay(
    {
      index: 2,
      status: 'occupied',
      member: {
        qq: '10001',
        martialArtIndex: '0',
        gearScore: '1200',
        characterId: 'Alpha',
        note: '',
        hasOrangeWeapon: true,
      },
      fixedRole: null,
      fixedMartialArtIndex: null,
    },
    { reservedSlots: [2], locked: false },
    '10001',
  )

  assert.equal(display.isMine, true)
  assert.equal(display.isBoss, true)
  assert.equal(display.hasOrangeWeapon, true)
  assert.match(display.className, /pixel-slot-owned/)
  assert.match(display.className, /pixel-slot-cw/)
})

test('occupied non-own slots keep the neutral occupied state', () => {
  const display = getOccupiedSlotDisplay(
    {
      index: 3,
      status: 'occupied',
      member: {
        qq: '20002',
        martialArtIndex: '1',
        gearScore: '800',
        characterId: 'Beta',
        note: '',
      },
      fixedRole: null,
      fixedMartialArtIndex: null,
    },
    { reservedSlots: [], locked: false },
    '10001',
  )

  assert.equal(display.isMine, false)
  assert.equal(display.isBoss, false)
  assert.match(display.className, /pixel-slot-occupied/)
  assert.doesNotMatch(display.className, /pixel-slot-owned/)
})
