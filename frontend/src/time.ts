export const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'
export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function toDate(value: Date | number | string) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toShanghaiDate(value: Date | number | string) {
  const date = toDate(value)
  if (!date) return null
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS)
}

function formatShanghaiDateParts(date: Date, includeSeconds: boolean, includeYear = true) {
  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1)
  const day = pad(date.getUTCDate())
  const hour = pad(date.getUTCHours())
  const minute = pad(date.getUTCMinutes())
  const dateText = includeYear ? `${year}/${month}/${day}` : `${month}/${day}`
  if (!includeSeconds) {
    return `${dateText} ${hour}:${minute}`
  }
  const second = pad(date.getUTCSeconds())
  return `${dateText} ${hour}:${minute}:${second}`
}

export function getShanghaiDateParts(value: Date | number | string) {
  const date = toShanghaiDate(value)
  if (!date) return null
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  }
}

export function addShanghaiDays(year: number, month: number, day: number, delta: number) {
  const shifted = new Date(Date.UTC(year, month - 1, day + delta))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

export function formatShanghaiDateTimeMinute(value: Date | number | string) {
  const date = toShanghaiDate(value)
  if (!date) return typeof value === 'string' ? value : ''
  return formatShanghaiDateParts(date, false)
}

export function formatShanghaiDateTimeSecond(value: Date | number | string) {
  const date = toShanghaiDate(value)
  if (!date) return typeof value === 'string' ? value : ''
  return formatShanghaiDateParts(date, true)
}

export function formatShanghaiMonthDayTimeMinute(value: Date | number | string) {
  const date = toShanghaiDate(value)
  if (!date) return typeof value === 'string' ? value : ''
  return formatShanghaiDateParts(date, false, false)
}

export function formatShanghaiMonthDayTimeSecond(value: Date | number | string) {
  const date = toShanghaiDate(value)
  if (!date) return typeof value === 'string' ? value : ''
  return formatShanghaiDateParts(date, true, false)
}

export function formatShanghaiDateTimeLocalInput(value: Date | number | string) {
  const date = toShanghaiDate(value)
  if (!date) return ''
  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1)
  const day = pad(date.getUTCDate())
  const hour = pad(date.getUTCHours())
  const minute = pad(date.getUTCMinutes())
  return `${year}-${month}-${day}T${hour}:${minute}`
}

export function parseShanghaiDateTimeLocalInput(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return null
  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }
  const timestamp = Date.UTC(year, month - 1, day, hour - 8, minute)
  return formatShanghaiDateTimeLocalInput(timestamp) === value ? timestamp : null
}
