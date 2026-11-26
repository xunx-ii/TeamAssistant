export interface MemberSessionState {
  qq: string
  token: string
  expiresAtMs: number
  nickname: string
  groupId: string
}

const STORAGE_KEY = 'team_member_session_v1'
let memorySession: MemberSessionState | null = null

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function parseSession(raw: string | null, qq: string): MemberSessionState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<MemberSessionState>
    if (
      parsed.qq === qq &&
      typeof parsed.token === 'string' &&
      parsed.token.length >= 32 &&
      typeof parsed.expiresAtMs === 'number' &&
      Number.isSafeInteger(parsed.expiresAtMs) &&
      parsed.expiresAtMs > Date.now() &&
      typeof parsed.nickname === 'string' &&
      typeof parsed.groupId === 'string' &&
      parsed.groupId.length > 0
    ) {
      return parsed as MemberSessionState
    }
  } catch {
    // Ignore malformed or expired sessions.
  }
  return null
}

export function readMemberSession(qq: string | null): MemberSessionState | null {
  if (!qq) return null
  if (memorySession?.qq === qq && memorySession.expiresAtMs > Date.now()) return memorySession
  const storage = getLocalStorage()
  try {
    const session = parseSession(storage?.getItem(STORAGE_KEY) ?? null, qq)
    if (session) {
      memorySession = session
      return session
    }
    memorySession = null
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
  return null
}

export function storeMemberSession(session: MemberSessionState) {
  memorySession = session
  try {
    getLocalStorage()?.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // The in-memory API token still keeps the current tab authenticated.
  }
}

export function clearMemberSession() {
  memorySession = null
  try {
    getLocalStorage()?.removeItem(STORAGE_KEY)
  } catch {
    // Best-effort cleanup only.
  }
}
