import { addShanghaiDays, getShanghaiDateParts, SHANGHAI_OFFSET_MS } from './time'

function formatWeekKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseDateKey(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return { year, month, day, weekday: date.getUTCDay() }
}

function getWeekStartParts(value: Date | number = new Date()) {
  const parts = getShanghaiDateParts(value)
  if (!parts) {
    return getShanghaiDateParts(new Date()) ?? { year: 1970, month: 1, day: 1, weekday: 1 }
  }
  const offset = parts.weekday === 0 ? -6 : 1 - parts.weekday
  return addShanghaiDays(parts.year, parts.month, parts.day, offset)
}

export function getWeekStartDate(value: Date | number = new Date()) {
  const parts = getShanghaiDateParts(value)
  if (!parts) return new Date(NaN)
  const offset = parts.weekday === 0 ? -6 : 1 - parts.weekday
  const monday = addShanghaiDays(parts.year, parts.month, parts.day, offset)
  return new Date(Date.UTC(monday.year, monday.month - 1, monday.day) - SHANGHAI_OFFSET_MS)
}

export function getWeekStartKey(value: Date | number = new Date()) {
  const parts = getWeekStartParts(value)
  return formatWeekKey(parts.year, parts.month, parts.day)
}

export function getShanghaiDateKey(value: Date | number = new Date()) {
  const parts = getShanghaiDateParts(value)
  if (!parts) return ''
  return formatWeekKey(parts.year, parts.month, parts.day)
}

export function getWeekStartKeyFromDateKey(value: string, fallback = getWeekStartKey()) {
  const parts = parseDateKey(value)
  if (!parts) return fallback
  const offset = parts.weekday === 0 ? -6 : 1 - parts.weekday
  const monday = addShanghaiDays(parts.year, parts.month, parts.day, offset)
  return formatWeekKey(monday.year, monday.month, monday.day)
}

export function normalizeWeekStartKey(value: unknown, fallback = '') {
  return typeof value === 'string' ? getWeekStartKeyFromDateKey(value, fallback) : fallback
}

export function addWeeksToWeekStartKey(value: string, weeks: number) {
  const parts = parseDateKey(value)
  if (!parts) return value
  const shifted = addShanghaiDays(parts.year, parts.month, parts.day, weeks * 7)
  return formatWeekKey(shifted.year, shifted.month, shifted.day)
}

export function getNextWeekStartKey(value: Date | number = new Date()) {
  return addWeeksToWeekStartKey(getWeekStartKey(value), 1)
}

export function formatWeekRange(value: string) {
  const parts = parseDateKey(value)
  if (!parts) return value
  const { year, month, day } = parts
  const end = addShanghaiDays(year, month, day, 6)
  return `${year}年${month}月${day}日-${end.year}年${end.month}月${end.day}日周`
}

export function getCurrentWeekStartKey() {
  return getWeekStartKey(new Date())
}
