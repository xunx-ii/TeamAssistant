const DAY_MS = 24 * 60 * 60 * 1000

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function getWeekStartDate(value: Date | number = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(value)
  date.setHours(0, 0, 0, 0)
  const day = date.getDay()
  const offset = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + offset)
  return date
}

export function getWeekStartKey(value: Date | number = new Date()) {
  const start = getWeekStartDate(value)
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
}

export function parseWeekStartKey(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return getWeekStartDate()
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(date.getTime()) ? getWeekStartDate() : getWeekStartDate(date)
}

export function formatWeekRange(value: string) {
  const start = parseWeekStartKey(value)
  const end = new Date(start.getTime() + 6 * DAY_MS)
  return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日-${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日周`
}

export function getCurrentWeekStartKey() {
  return getWeekStartKey(new Date())
}
