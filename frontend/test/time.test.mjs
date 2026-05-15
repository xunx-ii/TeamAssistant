import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatShanghaiDateTimeMinute,
  formatShanghaiMonthDayTimeMinute,
  formatShanghaiMonthDayTimeSecond,
} from '../src/time.ts'
import {
  formatWeekRange,
  getNextWeekStartKey,
  getShanghaiDateKey,
  getWeekStartDate,
  getWeekStartKey,
  getWeekStartKeyFromDateKey,
  normalizeWeekStartKey,
} from '../src/week.ts'

test('week helpers use Asia/Shanghai calendar boundaries', () => {
  assert.equal(getWeekStartKey(new Date('2026-05-03T15:59:59.999Z')), '2026-04-27')
  assert.equal(getWeekStartKey(new Date('2026-05-03T16:00:00.000Z')), '2026-05-04')
  assert.equal(getWeekStartDate(new Date('2026-05-06T02:00:00.000Z')).toISOString(), '2026-05-03T16:00:00.000Z')
  assert.equal(getShanghaiDateKey(new Date('2026-05-03T16:30:00.000Z')), '2026-05-04')
  assert.equal(getNextWeekStartKey(new Date('2026-05-09T00:00:00.000Z')), '2026-05-11')
  assert.equal(getWeekStartKeyFromDateKey('2026-05-17', '2026-05-04'), '2026-05-11')
  assert.equal(getWeekStartKeyFromDateKey('bad-value', '2026-05-04'), '2026-05-04')
  assert.equal(normalizeWeekStartKey('2026-05-24'), '2026-05-18')
  assert.equal(normalizeWeekStartKey('2026-02-31'), '')
  assert.equal(formatWeekRange('2026-99-99'), '2026-99-99')
  assert.equal(formatWeekRange('2025-12-29'), '2025年12月29日-2026年1月4日周')
})

test('Shanghai time formatters render fixed application timezone', () => {
  assert.equal(formatShanghaiDateTimeMinute('2026-01-01T03:00:00.000Z'), '2026/01/01 11:00')
  assert.equal(formatShanghaiMonthDayTimeMinute('2026-01-01T03:00:00.000Z'), '01/01 11:00')
  assert.equal(formatShanghaiMonthDayTimeSecond(1777770000000), '05/03 09:00:00')
})
