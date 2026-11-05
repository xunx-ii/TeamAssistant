import test from 'node:test'
import assert from 'node:assert/strict'
import { getMartialArt, martialArts } from '../src/data/martialArts.ts'
import { getFixedSlotLabel } from '../src/components/slotGridDisplay.ts'

test('invalid historical martial art indexes do not reach rendering code', () => {
  for (const value of ['-1', '999', '', '1x', '1.5', 'Infinity', -1, 999, 1.5, NaN, null, undefined, {}]) {
    assert.equal(getMartialArt(value), null, String(value))
  }
  assert.equal(getMartialArt('0'), martialArts[0])
  assert.equal(getMartialArt(0), martialArts[0])
  assert.equal(getMartialArt(String(martialArts.length - 1)), martialArts.at(-1))
})

test('invalid fixed martial arts fall back to the role label', () => {
  for (const index of [-1, 1.5, 999, NaN]) {
    assert.equal(getFixedSlotLabel({ fixedRole: 'T', fixedMartialArtIndex: index }, false), '🛡️ T 位')
  }
})
