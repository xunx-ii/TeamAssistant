import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canInteractWithSlotLock,
  getAssignedReservationLabel,
  getAvailableSlotLabel,
  getFixedSlotLabel,
  getOccupiedSlotDisplay,
  getReservedSlotLabel,
  getSlotLockOwnerLabel,
  getUserDisplayName,
  isAssignedReservationSlot,
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

test('users can reopen a slot that is locked by their own QQ', () => {
  assert.equal(canInteractWithSlotLock(false, '10001', '10001'), true)
  assert.equal(canInteractWithSlotLock(false, '10001', '20002'), false)
  assert.equal(canInteractWithSlotLock(true, '10001', '20002'), true)
  assert.equal(canInteractWithSlotLock(false, '10001', undefined), true)
})

test('slot lock labels prefer nickname and fall back to QQ', () => {
  const userProfiles = { 10001: { nickname: '兔扇' } }

  assert.equal(getUserDisplayName('10001', userProfiles), '兔扇')
  assert.equal(getUserDisplayName('20002', userProfiles), '20002')
  assert.equal(getSlotLockOwnerLabel('10001', userProfiles), '兔扇 编辑中')
  assert.equal(getSlotLockOwnerLabel(undefined, userProfiles), '编辑中')
})

test('assigned reservation slots show the reserved QQ nickname', () => {
  const slot = {
    index: 4,
    status: 'occupied',
    member: {
      qq: '20002',
      martialArtIndex: '4',
      gearScore: '',
      characterId: '',
      note: '',
    },
    fixedRole: null,
    fixedMartialArtIndex: null,
  }

  assert.equal(isAssignedReservationSlot(slot), true)
  assert.equal(getAssignedReservationLabel(slot, { 20002: { nickname: '小明' } }), '位置预留给了小明')
  assert.equal(getAssignedReservationLabel(slot, {}), '位置预留给了20002')
})

test('filled occupied slots are not treated as assigned reservations', () => {
  assert.equal(isAssignedReservationSlot({
    index: 5,
    status: 'occupied',
    member: {
      qq: '20002',
      martialArtIndex: '4',
      gearScore: '8',
      characterId: '小明角色',
      note: '',
    },
    fixedRole: null,
    fixedMartialArtIndex: null,
  }), false)
})

test('occupied own slots receive the theme border class', () => {
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
