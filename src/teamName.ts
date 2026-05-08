const MAX_TEAM_NAME_LENGTH = 40

export function normalizeTeamName(name: string, fallback = ''): string {
  const cleaned = Array.from(name)
    .join('')
    .split('')
    .map(char => {
      const code = char.charCodeAt(0)
      return code <= 31 || code === 127 ? ' ' : char
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

  const normalized = Array.from(cleaned).slice(0, MAX_TEAM_NAME_LENGTH).join('').trim()
  return normalized || fallback
}
