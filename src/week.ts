import { addShanghaiDays, getShanghaiDateParts, SHANGHAI_OFFSET_MS } from './time'

function formatWeekKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
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

export function formatWeekRange(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const end = addShanghaiDays(year, month, day, 6)
  return `${year}年${month}月${day}日-${end.year}年${end.month}月${end.day}日周`
}

export function getCurrentWeekStartKey() {
  return getWeekStartKey(new Date())
}
