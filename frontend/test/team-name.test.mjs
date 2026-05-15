import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeTeamName } from '../src/teamName.ts'

test('normalizeTeamName preserves regular emoji text', () => {
  assert.equal(normalizeTeamName(' 默认团队 🌸🧑‍🚀 '), '默认团队 🌸🧑‍🚀')
})

test('normalizeTeamName preserves embedded object markers for storage encoding', () => {
  assert.equal(normalizeTeamName('\uFFFC 默认团队 \uFFFC', '备用团队'), '\uFFFC 默认团队 \uFFFC')
  assert.equal(normalizeTeamName('\uFFFC', '备用团队'), '\uFFFC')
})

test('normalizeTeamName caps very long pasted names', () => {
  const normalized = normalizeTeamName(`团队${'🔥'.repeat(80)}`)
  assert.equal(Array.from(normalized).length, 40)
  assert.match(normalized, /^团队/)
})
