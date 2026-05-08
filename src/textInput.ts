export const TEXT_INPUT_LIMITS = {
  qq: 20,
  teamName: 40,
  characterId: 40,
  gearScore: 8,
  note: 300,
  cancelReason: 200,
  search: 40,
  subsidyName: 40,
  subsidyLevelName: 24,
}

type TextInputOptions = {
  maxLength?: number
  multiline?: boolean
}

const EMBEDDED_PAYLOAD_PATTERN = /\bdata:(?:image|audio|video|application)\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64,[a-z0-9+/=]+/gi
const MEDIA_HTML_PATTERN = /<(?:img|video|audio|source|object|embed|iframe)\b[^>]*>/gi
const FILE_REFERENCE_PATTERN = /\b(?:blob|filesystem|file):[^\s]+/gi
const OBJECT_REPLACEMENT_PATTERN = /\uFFFC/g
const BIDI_CONTROL_PATTERN = /[\u202A-\u202E\u2066-\u2069\uFEFF]/g

function isBlockedCodePoint(codePoint: number) {
  return (
    codePoint <= 0x08 ||
    codePoint === 0x0B ||
    codePoint === 0x0C ||
    (codePoint >= 0x0E && codePoint <= 0x1F) ||
    (codePoint >= 0x7F && codePoint <= 0x9F) ||
    (codePoint >= 0xD800 && codePoint <= 0xDFFF) ||
    (codePoint >= 0xFDD0 && codePoint <= 0xFDEF) ||
    (codePoint & 0xFFFE) === 0xFFFE
  )
}

function stripBlockedCodePoints(value: string) {
  return Array.from(value)
    .filter(char => !isBlockedCodePoint(char.codePointAt(0) ?? 0))
    .join('')
}

function limitTextLength(value: string, maxLength?: number) {
  if (!maxLength || maxLength <= 0) return value
  return Array.from(value).slice(0, maxLength).join('')
}

export function sanitizeTextInput(value: unknown, options: TextInputOptions = {}) {
  if (typeof value !== 'string') return ''

  const multiline = Boolean(options.multiline)
  const withoutPayloads = value
    .replace(EMBEDDED_PAYLOAD_PATTERN, '')
    .replace(MEDIA_HTML_PATTERN, '')
    .replace(FILE_REFERENCE_PATTERN, '')
    .replace(OBJECT_REPLACEMENT_PATTERN, '')
    .replace(BIDI_CONTROL_PATTERN, '')

  const withoutBlockedChars = stripBlockedCodePoints(withoutPayloads)
  const normalizedBreaks = withoutBlockedChars.replace(/\r\n?/g, '\n')
  const textOnly = multiline
    ? normalizedBreaks.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    : normalizedBreaks.replace(/\s+/g, ' ')

  return limitTextLength(textOnly, options.maxLength)
}

export function normalizeTextInput(value: unknown, options: TextInputOptions = {}) {
  const sanitized = sanitizeTextInput(value, options)
  if (options.multiline) {
    return sanitized
      .split('\n')
      .map(line => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  return sanitized.trim()
}

export function hasNonTextTransfer(data: DataTransfer | null) {
  if (!data) return false
  if (data.files.length > 0) return true

  const hasFileItem = Array.from(data.items).some(item => item.kind === 'file')
  if (hasFileItem) return true

  const html = data.getData('text/html')
  MEDIA_HTML_PATTERN.lastIndex = 0
  EMBEDDED_PAYLOAD_PATTERN.lastIndex = 0
  FILE_REFERENCE_PATTERN.lastIndex = 0
  return (
    MEDIA_HTML_PATTERN.test(html) ||
    EMBEDDED_PAYLOAD_PATTERN.test(html) ||
    FILE_REFERENCE_PATTERN.test(html)
  )
}

export function sanitizeIntegerInput(value: unknown, maxLength = TEXT_INPUT_LIMITS.gearScore) {
  if (typeof value !== 'string') return ''
  return value.replace(/\D+/g, '').slice(0, maxLength)
}
