import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeTextInput,
  sanitizeIntegerInput,
  sanitizeTextInput,
  TEXT_INPUT_LIMITS,
} from '../src/textInput.ts'

test('sanitizeTextInput keeps regular text and emoji while stripping embedded media markers', () => {
  const imageData = `data:image/png;base64,${Buffer.from('fake image data').toString('base64')}`
  const sanitized = sanitizeTextInput(` 角色 🌸🧑‍🚀 \uFFFC ${imageData}<img src="x"> `, {
    maxLength: TEXT_INPUT_LIMITS.note,
  })

  assert.equal(sanitized, ' 角色 🌸🧑‍🚀 ')
})

test('sanitizeTextInput removes binary control characters and invalid surrogates', () => {
  assert.equal(sanitizeTextInput('A\u0000B\u0008C\uD800D\u202EE'), 'ABCDE')
})

test('normalizeTextInput caps overlong text by code point', () => {
  const normalized = normalizeTextInput(`团队${'🔥'.repeat(80)}`, {
    maxLength: TEXT_INPUT_LIMITS.teamName,
  })

  assert.equal(Array.from(normalized).length, TEXT_INPUT_LIMITS.teamName)
  assert.match(normalized, /^团队/)
})

test('sanitizeIntegerInput accepts only short digit text', () => {
  assert.equal(sanitizeIntegerInput('12a3图片456789', 6), '123456')
})
